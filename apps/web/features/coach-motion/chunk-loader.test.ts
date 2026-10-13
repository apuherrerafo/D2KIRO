import { describe, expect, test } from "bun:test";
import { makeChunkLoader, type ChunkIO } from "./chunk-loader";
import { chunkKey, chunkUrl } from "./production-manifest";
import { FakeBitmap, WATCHING_LOOP, realManifest } from "./test-support";

const m = realManifest();
const key = chunkKey("384", WATCHING_LOOP, 2);
const meta = m.clips[WATCHING_LOOP].chunks[2];

function io(over: { status?: number; size?: number; w?: number; h?: number; decodeError?: Error } = {}) {
  const calls: Array<{ url: string; cache: string }> = [];
  const made: FakeBitmap[] = [];
  const impl: ChunkIO<FakeBitmap> = {
    fetch: async (url, init) => {
      calls.push({ url, cache: init.cache });
      return { ok: (over.status ?? 200) < 400, status: over.status ?? 200, blob: async () => ({ size: over.size ?? meta.bytes }) };
    },
    decode: async () => {
      if (over.decodeError) throw over.decodeError;
      const b = new FakeBitmap(key, over.w ?? meta.w, over.h ?? meta.h);
      made.push(b);
      return b;
    },
  };
  return { impl, calls, made };
}

describe("chunk loader · the bytes are checked against the manifest", () => {
  test("fetches the content-addressed URL and returns the decoded atlas when size and dimensions match", async () => {
    const t = io();
    const b = await makeChunkLoader(m, t.impl)(key, 1);
    expect(b.width).toBe(meta.w);
    expect(t.calls).toEqual([{ url: chunkUrl("384", meta.file), cache: "default" }]);
    expect(t.calls[0].url).toContain(meta.sha256.slice(0, 12));
  });

  test("the retry bypasses the HTTP cache (a corrupt cached answer would otherwise be served again)", async () => {
    const t = io();
    await makeChunkLoader(m, t.impl)(key, 2);
    expect(t.calls[0].cache).toBe("reload");
  });

  test("a non-OK status, a wrong byte size and an undecodable file all reject", async () => {
    await expect(makeChunkLoader(m, io({ status: 404 }).impl)(key, 1)).rejects.toThrow(`${meta.file}: 404`);
    await expect(makeChunkLoader(m, io({ size: meta.bytes - 1 }).impl)(key, 1)).rejects.toThrow(/bytes, manifest says/);
    await expect(makeChunkLoader(m, io({ decodeError: new Error("InvalidStateError") }).impl)(key, 1)).rejects.toThrow("InvalidStateError");
  });

  test("decoded dimensions that differ from the manifest's reject AND the bitmap is closed, never leaked", async () => {
    const t = io({ w: meta.w - 2 });
    await expect(makeChunkLoader(m, t.impl)(key, 1)).rejects.toThrow(`decoded ${meta.w - 2}x${meta.h}, manifest says ${meta.w}x${meta.h}`);
    expect(t.made).toHaveLength(1);
    expect(t.made[0].closed).toBe(1);
  });

  test("an unknown key rejects before any request", async () => {
    const t = io();
    await expect(makeChunkLoader(m, t.impl)("384/NOPE#0", 1)).rejects.toThrow("unknown chunk");
    expect(t.calls).toHaveLength(0);
  });
});
