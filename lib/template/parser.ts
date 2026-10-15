// ŞABLON AYRIŞTIRICI (Anki sözdizimi)
//
// "{{Ön}} <hr> {{#Arka}}{{Arka}}{{/Arka}}" gibi bir şablonu bir ağaca çevirir:
//   - text:        düz metin / HTML
//   - replacement: {{Alan}}, {{filtre:Alan}}, {{filtre1:filtre2:Alan}}
//   - conditional: {{#Alan}}...{{/Alan}} (alan doluysa) ve {{^Alan}}...{{/Alan}} (boşsa)

export type TemplateNode =
  | { type: "text"; text: string }
  | { type: "replacement"; field: string; filters: string[] }
  | { type: "conditional"; field: string; negated: boolean; children: TemplateNode[] };

export class TemplateError extends Error {}

const cache = new Map<string, TemplateNode[]>();

export function parseTemplate(template: string): TemplateNode[] {
  const cached = cache.get(template);
  if (cached) return cached;

  const root: TemplateNode[] = [];
  const stack: { field: string; nodes: TemplateNode[] }[] = [{ field: "", nodes: root }];
  const re = /\{\{([\s\S]*?)\}\}/g;
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(template))) {
    const current = stack[stack.length - 1].nodes;
    if (m.index > last) current.push({ type: "text", text: template.slice(last, m.index) });
    last = m.index + m[0].length;

    const inner = m[1].trim();
    const head = inner[0];
    if (head === "#" || head === "^") {
      const field = inner.slice(1).trim();
      const node: TemplateNode = { type: "conditional", field, negated: head === "^", children: [] };
      current.push(node);
      stack.push({ field, nodes: node.children });
    } else if (head === "/") {
      const field = inner.slice(1).trim();
      if (stack.length === 1) throw new TemplateError(`Açılmamış bölüm kapatılmış: {{/${field}}}`);
      const open = stack.pop()!;
      if (open.field !== field) {
        throw new TemplateError(`{{#${open.field}}} ile açılan bölüm {{/${field}}} ile kapatılmış`);
      }
    } else {
      const parts = inner.split(":");
      const field = parts.pop()!.trim();
      current.push({ type: "replacement", field, filters: parts.map((p) => p.trim()).filter(Boolean) });
    }
  }
  if (last < template.length) stack[stack.length - 1].nodes.push({ type: "text", text: template.slice(last) });
  if (stack.length > 1) throw new TemplateError(`{{#${stack[stack.length - 1].field}}} bölümü kapatılmamış`);

  if (cache.size > 500) cache.clear();
  cache.set(template, root);
  return root;
}

/** Şablonda geçen alan adları (koşullar dahil) */
export function referencedFields(template: string): Set<string> {
  const out = new Set<string>();
  const walk = (nodes: TemplateNode[]) => {
    for (const n of nodes) {
      if (n.type === "replacement") out.add(n.field);
      else if (n.type === "conditional") {
        out.add(n.field);
        walk(n.children);
      }
    }
  };
  walk(parseTemplate(template));
  return out;
}
