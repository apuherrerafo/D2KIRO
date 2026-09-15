// R1 S3.4 -- Valve KeyValues (KV1) text parser.
//
// npc_heroes.txt (Steam app 570, game/dota/scripts/npc/npc_heroes.txt) is written in Valve's
// KeyValues format: nested `"Key" { ... }` blocks, `"key" "value"` pairs, `//` line comments,
// double-quoted strings (with `\"` escapes), unquoted bare tokens for some keys. This is a
// general-purpose parser for that format -- pure, no I/O, fully offline (same posture as
// scripts/eval/**: never imported from apps/**, reads whatever text it's handed).
//
// Deliberately does NOT special-case anything hero-specific -- npc-heroes.ts (this same
// directory) is the layer that knows what "HeroID"/"Enabled"/"CMEnabled" mean. This file only
// knows KeyValues syntax.

export type KvValue = string | KvNode;
export interface KvNode {
  [key: string]: KvValue | KvValue[];
}

class KvTokenizer {
  private pos = 0;
  constructor(private readonly text: string) {}

  private peek(): string | undefined {
    return this.text[this.pos];
  }

  private skipWhitespaceAndComments(): void {
    for (;;) {
      while (this.pos < this.text.length && /\s/.test(this.text[this.pos]!)) this.pos += 1;
      if (this.text[this.pos] === "/" && this.text[this.pos + 1] === "/") {
        while (this.pos < this.text.length && this.text[this.pos] !== "\n") this.pos += 1;
        continue;
      }
      break;
    }
  }

  /** Returns the next token: a quoted string (unescaped), a `{`/`}` brace, or a bare unquoted token. `null` at end of input. */
  next(): string | null {
    this.skipWhitespaceAndComments();
    if (this.pos >= this.text.length) return null;

    const ch = this.peek();
    if (ch === "{" || ch === "}") {
      this.pos += 1;
      return ch;
    }

    if (ch === '"') {
      this.pos += 1;
      let out = "";
      while (this.pos < this.text.length && this.text[this.pos] !== '"') {
        if (this.text[this.pos] === "\\" && this.pos + 1 < this.text.length) {
          out += this.text[this.pos + 1];
          this.pos += 2;
          continue;
        }
        out += this.text[this.pos];
        this.pos += 1;
      }
      if (this.pos >= this.text.length) throw new Error("KV parse error: unterminated quoted string");
      this.pos += 1; // closing quote
      return out;
    }

    let out = "";
    while (this.pos < this.text.length && !/\s/.test(this.text[this.pos]!) && this.text[this.pos] !== "{" && this.text[this.pos] !== "}") {
      out += this.text[this.pos];
      this.pos += 1;
    }
    return out;
  }
}

/**
 * Parses a full KeyValues document into a root KvNode. Fail-closed: malformed input (unbalanced
 * braces, a key with no value/block) throws -- the caller (npc-heroes.ts / the orchestration
 * script) is expected to catch this and treat it exactly like any other corrupt-input case per
 * this repo's loader discipline (invariantes.md: "corrupto/ausente -> degrada, nunca lanza" at
 * the LOADER boundary; this low-level parser itself is allowed to throw, same relationship as
 * JSON.parse vs. a validated loadX() wrapper elsewhere in this codebase).
 */
export function parseKeyValues(text: string): KvNode {
  const tokenizer = new KvTokenizer(text);

  function parseBlock(expectClosingBrace: boolean): KvNode {
    const node: KvNode = {};
    for (;;) {
      const key = tokenizer.next();
      if (key === null) {
        if (expectClosingBrace) throw new Error("KV parse error: unexpected EOF before closing '}'");
        return node;
      }
      if (key === "}") {
        if (!expectClosingBrace) throw new Error("KV parse error: unexpected extra '}'");
        return node;
      }
      if (key === "{") throw new Error("KV parse error: unexpected '{' where a key was expected");

      const valueToken = tokenizer.next();
      if (valueToken === null) throw new Error(`KV parse error: key "${key}" has no value`);

      let value: KvValue;
      if (valueToken === "{") {
        value = parseBlock(true);
      } else if (valueToken === "}") {
        throw new Error(`KV parse error: key "${key}" followed immediately by '}'`);
      } else {
        value = valueToken;
      }

      const existing = node[key];
      if (existing === undefined) {
        node[key] = value;
      } else if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        node[key] = [existing, value];
      }
    }
  }

  return parseBlock(false);
}

/** Reads a nested KvNode as a plain object (never an array) at `key`, or `null` if absent/not a node. */
export function kvChild(node: KvNode, key: string): KvNode | null {
  const value = node[key];
  if (value === undefined || Array.isArray(value) || typeof value === "string") return null;
  return value;
}

/** Every direct child block of `node` that is itself a KvNode, as [key, node] pairs -- the shape DOTA_HeroList/npc_heroes.txt entries take (many sibling hero blocks under one root). */
export function kvChildEntries(node: KvNode): Array<[string, KvNode]> {
  const entries: Array<[string, KvNode]> = [];
  for (const [key, value] of Object.entries(node)) {
    if (Array.isArray(value) || typeof value === "string") continue;
    entries.push([key, value]);
  }
  return entries;
}

export function kvString(node: KvNode, key: string): string | null {
  const value = node[key];
  return typeof value === "string" ? value : null;
}
