export declare const SAMPLE: {
  noteTypes: { id: number; name: string; kind: number; fields: string[] }[];
  decks: { id: number; name: string[] }[];
  notes: { id: number; guid: string; mid: number; tags: string; flds: string[] }[];
};
export declare const SAMPLE_CSV: string;
export declare function buildApkg(format?: "legacy" | "latest"): Promise<Uint8Array>;
