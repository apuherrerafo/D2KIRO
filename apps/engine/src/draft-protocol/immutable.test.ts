import { describe, expect, test } from "bun:test";
import { deepClone, deepFreeze } from "./immutable";

describe("deepClone", () => {
  test("produce una copia independiente -- mutar el original no afecta la copia", () => {
    const original = { list: [1, 2, { nested: "a" }] };
    const clone = deepClone(original);
    original.list.push(999);
    (original.list[2] as { nested: string }).nested = "b";
    expect(clone.list).toEqual([1, 2, { nested: "a" }]);
  });
});

describe("deepFreeze", () => {
  test("congela el objeto y sus estructuras anidadas", () => {
    const value = deepFreeze({ list: [1, { nested: "a" }] });
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.list)).toBe(true);
    expect(Object.isFrozen(value.list[1])).toBe(true);
  });

  test("un intento de mutación sobre el resultado lanza (modo estricto)", () => {
    const value = deepFreeze({ list: [1, 2] });
    expect(() => {
      (value.list as number[]).push(3);
    }).toThrow();
  });
});
