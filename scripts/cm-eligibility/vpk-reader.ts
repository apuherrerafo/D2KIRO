// R1 S3.4 -- minimal Valve VPK v1/v2 directory reader.
//
// VPK is Source engine's package archive format. The binary layout implemented here follows the
// PUBLICLY DOCUMENTED format (Valve Developer Wiki, "VPK File Format" -- a published technical
// spec, not proprietary game content): a fixed header, then a directory tree of
// extension/path/filename-terminated strings, one fixed-size entry record per file (CRC, preload
// byte count, archive index, offset, length, a 0xFFFF terminator), followed immediately by each
// entry's preload bytes.
//
// IMPORTANT, read before trusting this against real data: this implementation has NOT been
// verified against an actual Steam depot file -- this environment has no licensed Dota 2
// install/VPK to test against (S3.4's own instructions anticipate exactly this case). It IS
// verified against hand-built synthetic buffers that follow the documented format exactly
// (vpk-reader.test.ts). Multi-part numbered archives (pak01_NNN.vpk, separate from _dir.vpk) are
// explicitly NOT implemented, for the same reason: guessing at that path's correctness with
// nothing real to validate against would be worse than refusing it outright (extractVpkEntry
// throws a clearly-labeled error for that case rather than returning wrong bytes).

const VPK_SIGNATURE = 0x55aa1234;
const VPK_ARCHIVE_INDEX_INLINE = 0x7fff;
const VPK_TERMINATOR = 0xffff;

export interface VpkDirectoryEntry {
  extension: string;
  /** "" for files at the archive root. */
  path: string;
  filename: string;
  fullPath: string;
  crc: number;
  preloadBytes: Uint8Array;
  archiveIndex: number;
  entryOffset: number;
  entryLength: number;
}

export interface VpkDirectory {
  version: number;
  entries: VpkDirectoryEntry[];
  /** Byte offset where entry data embedded in this same buffer (archiveIndex 0x7fff) begins. */
  dataSectionOffset: number;
}

class ByteReader {
  private pos = 0;
  private readonly view: DataView;
  constructor(private readonly buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }
  readUint32(): number {
    const value = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return value;
  }
  readUint16(): number {
    const value = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return value;
  }
  readCString(): string {
    const start = this.pos;
    while (this.buffer[this.pos] !== 0) {
      if (this.pos >= this.buffer.length) throw new Error("VPK parse error: unterminated string in directory tree");
      this.pos += 1;
    }
    const text = new TextDecoder("utf-8").decode(this.buffer.subarray(start, this.pos));
    this.pos += 1; // null terminator
    return text;
  }
  readBytes(length: number): Uint8Array {
    const out = this.buffer.subarray(this.pos, this.pos + length);
    this.pos += length;
    return out;
  }
  get position(): number {
    return this.pos;
  }
}

/** Parses a `_dir.vpk`'s header + directory tree. Fail-closed: any structural anomaly throws rather than returning a partial/guessed tree. */
export function parseVpkDirectory(buffer: Uint8Array): VpkDirectory {
  const reader = new ByteReader(buffer);
  const signature = reader.readUint32();
  if (signature !== VPK_SIGNATURE) {
    throw new Error(`VPK parse error: bad signature 0x${signature.toString(16).padStart(8, "0")} (expected 0x55aa1234)`);
  }
  const version = reader.readUint32();
  reader.readUint32(); // TreeSize -- informational only, not relied on for parsing bounds
  if (version === 2) {
    reader.readUint32(); // FileDataSectionSize
    reader.readUint32(); // ArchiveMD5SectionSize
    reader.readUint32(); // OtherMD5SectionSize
    reader.readUint32(); // SignatureSectionSize
  } else if (version !== 1) {
    throw new Error(`VPK parse error: unsupported version ${version} (only v1/v2 implemented)`);
  }

  const entries: VpkDirectoryEntry[] = [];
  for (;;) {
    const extension = reader.readCString();
    if (extension === "") break;
    for (;;) {
      const rawPath = reader.readCString();
      if (rawPath === "") break;
      const path = rawPath === " " ? "" : rawPath; // Valve encodes "root" as a single space
      for (;;) {
        const filename = reader.readCString();
        if (filename === "") break;
        const crc = reader.readUint32();
        const preloadBytesLength = reader.readUint16();
        const archiveIndex = reader.readUint16();
        const entryOffset = reader.readUint32();
        const entryLength = reader.readUint32();
        const terminator = reader.readUint16();
        if (terminator !== VPK_TERMINATOR) {
          throw new Error(`VPK parse error: directory entry for "${filename}.${extension}" has bad terminator`);
        }
        const preloadBytes = reader.readBytes(preloadBytesLength);
        const fullPath = path ? `${path}/${filename}.${extension}` : `${filename}.${extension}`;
        entries.push({ extension, path, filename, fullPath, crc, preloadBytes, archiveIndex, entryOffset, entryLength });
      }
    }
  }

  return { version, entries, dataSectionOffset: reader.position };
}

export function findVpkEntry(directory: VpkDirectory, fullPath: string): VpkDirectoryEntry | null {
  return directory.entries.find((entry) => entry.fullPath === fullPath) ?? null;
}

/**
 * Extracts one entry's full content. Supports the two cases this environment can actually verify:
 * an entry fully contained in its preload bytes (entryLength === 0), and an entry embedded inline
 * in the SAME `_dir.vpk` buffer (archiveIndex === 0x7fff -- the historical case for small text
 * files like npc_heroes.txt). A numbered-archive-part entry (archiveIndex !== 0x7fff) throws
 * rather than returning guessed-at bytes -- see the module header comment for why.
 */
export function extractVpkEntry(dirBuffer: Uint8Array, directory: VpkDirectory, entry: VpkDirectoryEntry): Uint8Array {
  if (entry.entryLength === 0) return entry.preloadBytes;
  if (entry.archiveIndex !== VPK_ARCHIVE_INDEX_INLINE) {
    throw new Error(
      `VPK extraction error: "${entry.fullPath}" lives in archive part ${entry.archiveIndex} ` +
        `(pak01_${String(entry.archiveIndex).padStart(3, "0")}.vpk) -- multi-part archive reading is not ` +
        `implemented in this tool (no real Steam depot available in this environment to verify it against).`,
    );
  }
  const start = directory.dataSectionOffset + entry.entryOffset;
  const inlineBytes = dirBuffer.subarray(start, start + entry.entryLength);
  const combined = new Uint8Array(entry.preloadBytes.length + inlineBytes.length);
  combined.set(entry.preloadBytes, 0);
  combined.set(inlineBytes, entry.preloadBytes.length);
  return combined;
}
