// İçe aktarma için düşük seviyeli yardımcılar: zip, zstd, protobuf.
import { unzipSync } from "fflate";
import { decompress as zstdDecompress } from "fzstd";

// ------------------------------------------------------------------ ZIP

/** Zip içindeki dosya adları (içerikleri açmadan) */
export function listZipEntries(data: Uint8Array): string[] {
  const names: string[] = [];
  unzipSync(data, {
    filter: (f) => {
      names.push(f.name);
      return false;
    },
  });
  return names;
}

/** Sadece istenen dosyaları açar (büyük paketlerde belleği korumak için) */
export function readZipEntries(data: Uint8Array, wanted: Set<string>): Record<string, Uint8Array> {
  return unzipSync(data, { filter: (f) => wanted.has(f.name) });
}

// ------------------------------------------------------------------ ZSTD

export function isZstd(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x28 && bytes[1] === 0xb5 && bytes[2] === 0x2f && bytes[3] === 0xfd;
}

/** zstd ile sıkıştırılmışsa açar, değilse olduğu gibi döndürür */
export function maybeZstd(bytes: Uint8Array): Uint8Array {
  return isZstd(bytes) ? zstdDecompress(bytes) : bytes;
}

// ------------------------------------------------------------------ PROTOBUF (okuyucu)
// Yeni Anki formatı (anki21b) not tipi/şablon/alan ayarlarını protobuf ile saklar.
// Bize gereken birkaç alanı okuyan küçük bir çözücü.

export type ProtoValue = number | bigint | Uint8Array;
export type ProtoMessage = Map<number, ProtoValue[]>;

function readVarint(buf: Uint8Array, pos: number): [bigint, number] {
  let result = 0n;
  let shift = 0n;
  for (;;) {
    if (pos >= buf.length) throw new Error("protobuf: beklenmeyen son");
    const b = buf[pos++];
    result |= BigInt(b & 0x7f) << shift;
    if ((b & 0x80) === 0) return [result, pos];
    shift += 7n;
  }
}

export function decodeProto(buf: Uint8Array): ProtoMessage {
  const msg: ProtoMessage = new Map();
  let pos = 0;
  const add = (field: number, v: ProtoValue) => {
    const list = msg.get(field);
    if (list) list.push(v);
    else msg.set(field, [v]);
  };
  while (pos < buf.length) {
    const [key, p1] = readVarint(buf, pos);
    pos = p1;
    const field = Number(key >> 3n);
    const wire = Number(key & 7n);
    if (wire === 0) {
      const [v, p] = readVarint(buf, pos);
      pos = p;
      add(field, v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v);
    } else if (wire === 2) {
      const [len, p] = readVarint(buf, pos);
      const end = p + Number(len);
      add(field, buf.subarray(p, end));
      pos = end;
    } else if (wire === 1) {
      add(field, buf.subarray(pos, pos + 8));
      pos += 8;
    } else if (wire === 5) {
      add(field, buf.subarray(pos, pos + 4));
      pos += 4;
    } else {
      throw new Error(`protobuf: desteklenmeyen tür ${wire}`);
    }
  }
  return msg;
}

const decoder = new TextDecoder();

export const proto = {
  str(msg: ProtoMessage, field: number, def = ""): string {
    const v = msg.get(field)?.[0];
    return v instanceof Uint8Array ? decoder.decode(v) : def;
  },
  num(msg: ProtoMessage, field: number, def = 0): number {
    const v = msg.get(field)?.[0];
    return typeof v === "number" ? v : typeof v === "bigint" ? Number(v) : def;
  },
  bool(msg: ProtoMessage, field: number): boolean {
    return proto.num(msg, field) !== 0;
  },
  bytes(msg: ProtoMessage, field: number): Uint8Array | null {
    const v = msg.get(field)?.[0];
    return v instanceof Uint8Array ? v : null;
  },
  messages(msg: ProtoMessage, field: number): ProtoMessage[] {
    return (msg.get(field) ?? []).filter((v): v is Uint8Array => v instanceof Uint8Array).map(decodeProto);
  },
};
