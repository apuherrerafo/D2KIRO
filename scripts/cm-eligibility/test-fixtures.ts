// Test-only synthetic VPK v1 buffer builder, shared by vpk-reader.test.ts and
// build-snapshot.test.ts -- NOT real Valve data, never imported by build-snapshot.ts itself.

class ByteWriter {
  private chunks: number[] = [];
  writeUint32(value: number): this {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setUint32(0, value, true);
    this.chunks.push(...new Uint8Array(buf));
    return this;
  }
  writeUint16(value: number): this {
    const buf = new ArrayBuffer(2);
    new DataView(buf).setUint16(0, value, true);
    this.chunks.push(...new Uint8Array(buf));
    return this;
  }
  writeCString(value: string): this {
    this.chunks.push(...new TextEncoder().encode(value), 0);
    return this;
  }
  toBuffer(): Uint8Array {
    return new Uint8Array(this.chunks);
  }
}

export interface SyntheticVpkFixtureEntry {
  extension: string;
  path: string; // "" for root
  filename: string;
  content: string;
}

export function buildSyntheticVpkV1(entries: SyntheticVpkFixtureEntry[]): Uint8Array {
  const tree = new ByteWriter();
  const dataSections: Uint8Array[] = [];
  const byExtension = new Map<string, Map<string, SyntheticVpkFixtureEntry[]>>();
  for (const entry of entries) {
    const byPath = byExtension.get(entry.extension) ?? new Map<string, SyntheticVpkFixtureEntry[]>();
    const list = byPath.get(entry.path) ?? [];
    list.push(entry);
    byPath.set(entry.path, list);
    byExtension.set(entry.extension, byPath);
  }

  let runningOffset = 0;
  for (const [extension, byPath] of byExtension) {
    tree.writeCString(extension);
    for (const [path, list] of byPath) {
      tree.writeCString(path === "" ? " " : path);
      for (const entry of list) {
        const contentBytes = new TextEncoder().encode(entry.content);
        tree.writeCString(entry.filename);
        tree.writeUint32(0);
        tree.writeUint16(0);
        tree.writeUint16(0x7fff);
        tree.writeUint32(runningOffset);
        tree.writeUint32(contentBytes.length);
        tree.writeUint16(0xffff);
        dataSections.push(contentBytes);
        runningOffset += contentBytes.length;
      }
      tree.writeCString("");
    }
    tree.writeCString("");
  }
  tree.writeCString("");

  const treeBytes = tree.toBuffer();
  const header = new ByteWriter().writeUint32(0x55aa1234).writeUint32(1).writeUint32(treeBytes.length).toBuffer();

  const totalDataLength = dataSections.reduce((sum, chunk) => sum + chunk.length, 0);
  const combined = new Uint8Array(header.length + treeBytes.length + totalDataLength);
  combined.set(header, 0);
  combined.set(treeBytes, header.length);
  let cursor = header.length + treeBytes.length;
  for (const chunk of dataSections) {
    combined.set(chunk, cursor);
    cursor += chunk.length;
  }
  return combined;
}
