// ANKI ARAMA SÖZDİZİMİ AYRIŞTIRICISI
// Arama metnini bir ağaca (AST) çevirir; değerlendirme lib/search/evaluate.ts'te.
//
// Desteklenenler:
//   kelime            herhangi bir alanda geçiyor (büyük/küçük harf duyarsız)
//   "iki kelime"      tam ifade
//   d*g  d_g          joker: * = herhangi karakterler, _ = tek karakter (\* \_ ile kaçır)
//   -kelime           olumsuzlama;  a or b ;  (a or b) c ;  and yazmak opsiyonel
//   deck:Ad  tag:ad  note:TipAdı  card:ŞablonAdı|n  Alan:değer  Alan:re:desen
//   is:new|learn|review|due|suspended|buried   flag:0-7
//   prop:ivl>=10 (ivl, due, reps, lapses, ease, s, d, r, pos)
//   rated:n[:1-4]  added:n  edited:n  introduced:n
//   re:desen  nc:metin (aksansız)  dupe:notTipi,metin  nid:… cid:…
//   EK: examples:0  examples<3  examples>=2 (örnek cümle sayısı)

export class SearchError extends Error {}

export type CompareOp = "<" | "<=" | ">" | ">=" | "=" | "!=";

export type Term =
  | { kind: "text"; pattern: string } // ham (kaçışlı) desen
  | { kind: "field"; field: string; pattern: string; regex: boolean }
  | { kind: "deck"; pattern: string }
  | { kind: "tag"; pattern: string }
  | { kind: "note"; pattern: string }
  | { kind: "card"; pattern: string }
  | { kind: "is"; value: "new" | "learn" | "review" | "due" | "suspended" | "buried" }
  | { kind: "flag"; value: number }
  | { kind: "prop"; prop: PropName; op: CompareOp; value: number }
  | { kind: "rated"; days: number; ease: number | null }
  | { kind: "added" | "edited" | "introduced"; days: number }
  | { kind: "re"; pattern: string }
  | { kind: "nc"; text: string }
  | { kind: "dupe"; noteType: string; text: string }
  | { kind: "examples"; op: CompareOp; value: number }
  | { kind: "nid" | "cid"; ids: string[] };

export type PropName = "ivl" | "due" | "reps" | "lapses" | "ease" | "s" | "d" | "r" | "pos";

export type SearchNode =
  | { type: "and"; children: SearchNode[] }
  | { type: "or"; children: SearchNode[] }
  | { type: "not"; child: SearchNode }
  | { type: "term"; term: Term }
  | { type: "all" }; // boş arama: her şey

type Token =
  | { t: "(" }
  | { t: ")" }
  | { t: "neg" } // -( …
  | { t: "or" }
  | { t: "and" }
  | { t: "term"; raw: string };

const IS_VALUES = new Set(["new", "learn", "review", "due", "suspended", "buried"]);
const PROPS = new Set<PropName>(["ivl", "due", "reps", "lapses", "ease", "s", "d", "r", "pos"]);
const KEYS = new Set(["deck", "tag", "note", "card", "is", "flag", "prop", "rated", "added", "edited", "introduced", "re", "nc", "dupe", "examples", "nid", "cid"]);

/** Metni parçalara ayırır. Tırnaklar atılır; kaçışlar (\x) olduğu gibi kalır. */
function tokenize(input: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "(") {
      out.push({ t: "(" });
      i++;
      continue;
    }
    if (c === ")") {
      out.push({ t: ")" });
      i++;
      continue;
    }
    if (c === "-" && input[i + 1] === "(") {
      out.push({ t: "neg" });
      i++;
      continue;
    }
    let raw = "";
    let quoted = false;
    let inQuote = false;
    while (i < input.length) {
      const ch = input[i];
      if (ch === "\\" && i + 1 < input.length) {
        raw += ch + input[i + 1];
        i += 2;
        continue;
      }
      if (ch === '"') {
        inQuote = !inQuote;
        quoted = true;
        i++;
        continue;
      }
      if (!inQuote && (/\s/.test(ch) || ch === "(" || ch === ")")) break;
      raw += ch;
      i++;
    }
    if (inQuote) throw new SearchError("Kapanmamış tırnak işareti var.");
    const lower = raw.toLowerCase();
    if (!quoted && lower === "or") out.push({ t: "or" });
    else if (!quoted && lower === "and") out.push({ t: "and" });
    else if (raw !== "" || quoted) out.push({ t: "term", raw });
  }
  return out;
}

/** Kaçışları çözer (\" → ", \: → : …). Joker kaçışları (\* \_) korunur. */
export function unescapeKeepWildcards(raw: string): string {
  return raw.replace(/\\(.)/g, (m, ch: string) => (ch === "*" || ch === "_" || ch === "\\" ? m : ch));
}

/** Tüm kaçışları çözer (jokersiz değerler için) */
function unescapeAll(raw: string): string {
  return raw.replace(/\\(.)/g, "$1");
}

/** İlk kaçışsız iki nokta üst üstenin yeri (-1: yok) */
function firstColon(raw: string): number {
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "\\") {
      i++;
      continue;
    }
    if (raw[i] === ":") return i;
  }
  return -1;
}

function parseCount(value: string, what: string, max = 36500): number {
  const n = Number(value);
  if (!/^\d+$/.test(value) || n < 1) throw new SearchError(`${what} için 1 veya daha büyük bir gün sayısı yaz (ör. ${what}:7).`);
  return Math.min(n, max);
}

const COMPARE = /^(<=|>=|!=|=|<|>)(-?\d+(?:\.\d+)?)$/;

function parseTerm(rawIn: string): SearchNode {
  let raw = rawIn;
  // -kelime → olumsuz
  if (raw.length > 1 && raw[0] === "-") {
    return { type: "not", child: parseTerm(raw.slice(1)) };
  }
  // examples<3 gibi (iki nokta olmadan karşılaştırma)
  const ex = /^examples(<=|>=|!=|=|<|>|:)(\d+)$/i.exec(raw);
  if (ex) {
    return { type: "term", term: { kind: "examples", op: ex[1] === ":" ? "=" : (ex[1] as CompareOp), value: Number(ex[2]) } };
  }

  const colon = firstColon(raw);
  if (colon <= 0) {
    if (raw === "") throw new SearchError("Boş arama terimi.");
    return { type: "term", term: { kind: "text", pattern: unescapeKeepWildcards(raw) } };
  }
  const key = unescapeAll(raw.slice(0, colon));
  const value = raw.slice(colon + 1);
  const lowerKey = key.toLowerCase();

  if (!KEYS.has(lowerKey)) {
    // Alan araması: Alan:değer  veya  Alan:re:desen
    if (/^re:/i.test(value)) {
      return { type: "term", term: { kind: "field", field: unescapeKeepWildcards(key), pattern: unescapeAll(value.slice(3)), regex: true } };
    }
    return { type: "term", term: { kind: "field", field: unescapeKeepWildcards(key), pattern: unescapeKeepWildcards(value), regex: false } };
  }

  const v = unescapeKeepWildcards(value);
  switch (lowerKey) {
    case "deck":
    case "tag":
    case "note":
    case "card":
      if (!v) throw new SearchError(`${lowerKey}: sonrasına bir ad yaz.`);
      return { type: "term", term: { kind: lowerKey, pattern: v } };
    case "is": {
      const val = v.toLowerCase();
      if (!IS_VALUES.has(val)) {
        throw new SearchError(`Bilinmeyen durum: is:${v}. Kullanılabilenler: new, learn, review, due, suspended, buried.`);
      }
      return { type: "term", term: { kind: "is", value: val as Extract<Term, { kind: "is" }>["value"] } };
    }
    case "flag": {
      const n = Number(v);
      if (!/^[0-7]$/.test(v)) throw new SearchError("flag: 0 ile 7 arasında olmalı (0 = bayraksız).");
      return { type: "term", term: { kind: "flag", value: n } };
    }
    case "prop": {
      const m = /^([a-z]+)(<=|>=|!=|=|<|>)(-?\d+(?:\.\d+)?)$/i.exec(unescapeAll(value));
      if (!m || !PROPS.has(m[1].toLowerCase() as PropName)) {
        throw new SearchError("prop: biçimi hatalı. Örnek: prop:ivl>=10 (ivl, due, reps, lapses, ease, s, d, r, pos).");
      }
      return {
        type: "term",
        term: { kind: "prop", prop: m[1].toLowerCase() as PropName, op: m[2] as CompareOp, value: Number(m[3]) },
      };
    }
    case "rated": {
      const [days, ease] = unescapeAll(value).split(":");
      const d = parseCount(days, "rated", 365);
      if (ease !== undefined && !/^[1-4]$/.test(ease)) throw new SearchError("rated:gün:buton — buton 1 ile 4 arasında olmalı.");
      return { type: "term", term: { kind: "rated", days: d, ease: ease ? Number(ease) : null } };
    }
    case "added":
    case "edited":
    case "introduced":
      return { type: "term", term: { kind: lowerKey, days: parseCount(unescapeAll(value), lowerKey) } };
    case "re":
      if (!value) throw new SearchError("re: sonrasına bir desen yaz.");
      return { type: "term", term: { kind: "re", pattern: unescapeAll(value) } };
    case "nc":
      return { type: "term", term: { kind: "nc", text: unescapeKeepWildcards(value) } };
    case "dupe": {
      const all = unescapeAll(value);
      const comma = all.indexOf(",");
      if (comma <= 0) throw new SearchError("dupe: biçimi: dupe:NotTipi,metin");
      return { type: "term", term: { kind: "dupe", noteType: all.slice(0, comma), text: all.slice(comma + 1) } };
    }
    case "examples": {
      const m = COMPARE.exec(unescapeAll(value)) ?? /^(\d+)$/.exec(unescapeAll(value));
      if (!m) throw new SearchError("examples biçimi: examples:0, examples<3, examples>=2");
      const op = (m.length === 3 ? m[1] : "=") as CompareOp;
      return { type: "term", term: { kind: "examples", op, value: Number(m[m.length - 1]) } };
    }
    case "nid":
    case "cid": {
      const ids = unescapeAll(value).split(",").map((x) => x.trim()).filter(Boolean);
      if (!ids.length) throw new SearchError(`${lowerKey}: sonrasına kimlik yaz.`);
      return { type: "term", term: { kind: lowerKey, ids } };
    }
  }
  throw new SearchError(`Bilinmeyen arama: ${raw}`);
}

/** Arama metnini ağaca çevirir. Hatalıysa SearchError fırlatır. */
export function parseSearch(input: string): SearchNode {
  const tokens = tokenize(input);
  let pos = 0;
  const peek = () => tokens[pos];

  function parseOr(): SearchNode {
    const children = [parseAnd()];
    while (peek()?.t === "or") {
      pos++;
      if (!peek() || peek()!.t === ")" || peek()!.t === "or") throw new SearchError("'or' sonrasında bir terim olmalı.");
      children.push(parseAnd());
    }
    return children.length === 1 ? children[0] : { type: "or", children };
  }

  function parseAnd(): SearchNode {
    const children: SearchNode[] = [];
    while (pos < tokens.length) {
      const tok = peek()!;
      if (tok.t === ")" || tok.t === "or") break;
      if (tok.t === "and") {
        pos++;
        continue;
      }
      children.push(parseUnary());
    }
    if (!children.length) throw new SearchError("Arama eksik: boş parantez ya da başta/sonda 'or' var.");
    return children.length === 1 ? children[0] : { type: "and", children };
  }

  function parseUnary(): SearchNode {
    const tok = tokens[pos++];
    if (tok.t === "neg") {
      if (peek()?.t !== "(") throw new SearchError("'-' sonrasında parantez bekleniyordu.");
      return { type: "not", child: parseUnary() };
    }
    if (tok.t === "(") {
      const inner = parseOr();
      if (peek()?.t !== ")") throw new SearchError("Kapanmamış parantez var.");
      pos++;
      return inner;
    }
    if (tok.t === "term") return parseTerm(tok.raw);
    throw new SearchError("Arama anlaşılamadı: fazladan ')' var.");
  }

  if (!tokens.length) return { type: "all" };
  const node = parseOr();
  if (pos < tokens.length) throw new SearchError("Fazladan ')' var.");
  return node;
}

/** Joker desenini (* _ ve kaçışları) düzenli ifadeye çevirir */
export function wildcardToRegex(pattern: string, anchored: boolean): RegExp {
  let src = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\" && i + 1 < pattern.length) {
      src += escapeRegex(pattern[++i]);
    } else if (c === "*") src += "[\\s\\S]*";
    else if (c === "_") src += "[\\s\\S]";
    else if (/[iIİı]/.test(c)) src += "[iIİı]"; // Türkçe i/ı farkını yok say
    else src += escapeRegex(c);
  }
  return new RegExp(anchored ? `^${src}$` : src, "i");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Arama metnine güvenle koymak için değeri tırnaklar/kaçışlar */
export function quoteSearchValue(value: string): string {
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\*/g, "\\*").replace(/_/g, "\\_");
  return /[\s()"-]/.test(value) ? `"${escaped}"` : escaped;
}
