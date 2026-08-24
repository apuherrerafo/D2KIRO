import type { DraftCandidate } from "./corpus";
import type { HeroId } from "../draft/reducer";

// Fase 5 (pro-drafter-spec-v1.md §2.1): índice invertido en memoria sobre el corpus curado --
// bitmask real, no solo Map/Set, para satisfacer el lenguaje "bitmask/inverted index" de la
// prosa del doc. Cada Uint32Array es un bitmask sobre los índices del corpus: el bit `i` está
// encendido si `corpus[i]` incluye ese héroe (en cualquiera de los dos lados).

const WORD_BITS = 32;

export interface InMemoryDraftIndex {
  readonly corpusSize: number;
  readonly patch: string;
  readonly postings: ReadonlyMap<HeroId, Uint32Array>;
  candidatesFor(partialDraft: readonly HeroId[]): readonly DraftCandidate[];
}

// Kernighan: apaga el bit más bajo encendido en cada iteración -- O(bits encendidos), no O(32).
// Exportada y testeada aislada; `pushSetBitPositions` reutiliza la misma técnica para conservar
// la posición de cada bit en vez de solo contarlos.
export function popcount(word: number): number {
  let bits = word >>> 0; // trata la palabra como 32 bits sin signo
  let count = 0;
  while (bits !== 0) {
    bits &= bits - 1;
    count++;
  }
  return count;
}

function pushSetBitPositions(word: number, wordOffset: number, out: number[]): void {
  let bits = word >>> 0;
  while (bits !== 0) {
    const lowestBit = bits & -bits;
    out.push(wordOffset + 31 - Math.clz32(lowestBit));
    bits &= bits - 1; // Kernighan: misma técnica que popcount
  }
}

export function buildDraftIndex(corpus: readonly DraftCandidate[], patch: string): InMemoryDraftIndex {
  const corpusSize = corpus.length;
  const wordCount = Math.ceil(corpusSize / WORD_BITS);
  const postings = new Map<HeroId, Uint32Array>();

  corpus.forEach((draft, draftIndex) => {
    const heroesInDraft = new Set<HeroId>([...draft.radiantHeroes, ...draft.direHeroes]);
    const word = draftIndex >>> 5; // Math.floor(draftIndex / 32)
    const bit = draftIndex & 31; // draftIndex % 32

    for (const hero of heroesInDraft) {
      let mask = postings.get(hero);
      if (!mask) {
        mask = new Uint32Array(wordCount);
        postings.set(hero, mask);
      }
      mask[word] = (mask[word] ?? 0) | (1 << bit);
    }
  });

  function candidatesFor(partialDraft: readonly HeroId[]): readonly DraftCandidate[] {
    if (partialDraft.length === 0) return corpus;

    const masks: Uint32Array[] = [];
    for (const hero of partialDraft) {
      const mask = postings.get(hero);
      if (!mask) return []; // héroe ausente del corpus -- intersección vacía, nunca lanza
      masks.push(mask);
    }

    const draftIndices: number[] = [];
    for (let w = 0; w < wordCount; w++) {
      let intersected = masks[0]?.[w] ?? 0;
      for (let i = 1; i < masks.length && intersected !== 0; i++) {
        intersected &= masks[i]?.[w] ?? 0;
      }
      if (intersected !== 0) pushSetBitPositions(intersected, w * WORD_BITS, draftIndices);
    }

    return draftIndices
      .map((i) => corpus[i])
      .filter((draft): draft is DraftCandidate => draft !== undefined);
  }

  return { corpusSize, patch, postings, candidatesFor };
}
