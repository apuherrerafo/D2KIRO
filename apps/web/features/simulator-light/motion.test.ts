import { describe, expect, test } from "bun:test";
import { boxWithin, travelDelta } from "./motion";

describe("motion · geometría pura del marco que viaja (movimiento 09)", () => {
  test("travelDelta: desplazamiento para que un marco ya puesto en `to` parezca salir de `from`", () => {
    expect(travelDelta({ left: 100, top: 40, width: 10, height: 10 }, { left: 20, top: 90, width: 10, height: 10 })).toEqual({ x: 80, y: -50 });
  });
  test("travelDelta: mismo lugar = cero (no se anima nada)", () => {
    const box = { left: 12, top: 34, width: 5, height: 6 };
    expect(travelDelta(box, box)).toEqual({ x: 0, y: 0 });
  });
  test("boxWithin: caja relativa al contenedor, conserva el tamaño", () => {
    expect(boxWithin({ left: 10, top: 20 }, { left: 110, top: 70, width: 300, height: 90 })).toEqual({ left: 100, top: 50, width: 300, height: 90 });
  });
});
