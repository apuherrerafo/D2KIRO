/* DS V1 · Round 3B — D2KIRO custom iconography (experimental, PROPOSAL).
   Construction system, shared by every glyph:
   - 16-unit grid, 1.5 stroke, square caps, miter joins (crisp at UI size)
   - 45° corner cuts of 2.5 units instead of round corners
   - data nodes: 2×2 filled squares; the "presence" node is the only diamond
   - partial enclosures: no glyph is a fully closed shape
   - ONE motion verb per glyph, played once per trigger, then rest
   Icons are always decorative (aria-hidden): the host must carry the text label. */
import type { CSSProperties } from "react";

export type IconName = "inspect" | "live" | "confirm" | "signal" | "shift" | "attention";

export type IconSpec = {
  concept: string;
  construction: string;
  label: string;
  name: IconName;
  verb: string;
  verbMeaning: string;
};

export const ICONS: IconSpec[] = [
  { name: "inspect", label: "Ver detalle", concept: "inspeccionar / detalle", verb: "TRAVEL", verbMeaning: "el nodo entra por la sonda hasta el centro y el marco se abre", construction: "dos esquinas cortadas opuestas + sonda diagonal + nodo" },
  { name: "live", label: "en vivo", concept: "en vivo", verb: "PULSE", verbMeaning: "un único latido: los cuartos de órbita se abren en diagonal y vuelven", construction: "nodo rombo (presencia) + dos cuartos de órbita en diagonal" },
  { name: "confirm", label: "Confirmar pick", concept: "confirmar / fijar", verb: "LOCK", verbMeaning: "el trazo se dibuja y la esquina superior se cierra un instante", construction: "recinto en L con corte + trazo que sale por arriba; el cierre superior es el «lock»" },
  { name: "signal", label: "Evidencia", concept: "evidencia / señal", verb: "GATHER", verbMeaning: "los nodos dispersos se reúnen en la escalera de señal", construction: "línea base + 1·2·3 nodos de dato" },
  { name: "shift", label: "Reubicar", concept: "desplazar / reposicionar", verb: "TRANSLATE", verbMeaning: "la ruta se desplaza y deja un nodo fantasma en la posición anterior", construction: "nodo fantasma + ruta escalonada a 45° + nodo acento de destino" },
  { name: "attention", label: "Atención", concept: "alerta / atención", verb: "BRACKET", verbMeaning: "las cuatro esquinas se cierran sobre la marca y vuelven", construction: "cuatro esquinas abiertas + marca vertical + nodo" },
];

export const ICON_BY_NAME = new Map(ICONS.map((icon) => [icon.name, icon]));

function Node({ className = "", x, y }: { className?: string; x: number; y: number }) {
  return <rect className={`d2i-node ${className}`} height="2" width="2" x={x} y={y} />;
}

function Glyph({ name }: { name: IconName }) {
  if (name === "inspect") {
    return (
      <>
        <path className="d2i-frame d2i-frame--a" d="M2 7.5V4.5L4.5 2h3" />
        <path className="d2i-frame d2i-frame--b" d="M14 8.5v3L11.5 14h-3" />
        <path className="d2i-probe" d="M10 6l3.5-3.5" pathLength={100} />
        <Node className="d2i-node--accent d2i-traveller" x={7} y={7} />
      </>
    );
  }
  if (name === "live") {
    return (
      <>
        <path className="d2i-orbit d2i-orbit--r" d="M8.6 2.3a5.8 5.8 0 0 1 5.1 5.1" />
        <path className="d2i-orbit d2i-orbit--l" d="M7.4 13.7a5.8 5.8 0 0 1-5.1-5.1" />
        <path className="d2i-node d2i-node--accent d2i-core" d="M8 5.6 10.4 8 8 10.4 5.6 8Z" />
      </>
    );
  }
  if (name === "confirm") {
    return (
      <>
        <path className="d2i-frame" d="M2 8v6h9.5l2.5-2.5V9.5" />
        <path className="d2i-lock" d="M2 6V4.5L4.5 2H8" pathLength={100} />
        <path className="d2i-check d2i-accent-stroke" d="M4.8 7.8l2.6 2.6L13.8 4" pathLength={100} />
      </>
    );
  }
  if (name === "signal") {
    return (
      <>
        <path className="d2i-base" d="M2 14.25h12" />
        <Node className="d2i-gather" x={2.5} y={10.5} />
        <Node className="d2i-gather" x={7} y={10.5} />
        <Node className="d2i-gather" x={7} y={7} />
        <Node className="d2i-gather" x={11.5} y={10.5} />
        <Node className="d2i-gather" x={11.5} y={7} />
        <Node className="d2i-gather d2i-node--accent" x={11.5} y={3.5} />
      </>
    );
  }
  if (name === "shift") {
    return (
      <>
        <Node className="d2i-ghost" x={1.5} y={3.5} />
        <g className="d2i-shifter">
          <path d="M5 4.5h2.5l4.25 4.25" />
          <Node className="d2i-node--accent" x={12} y={10.5} />
        </g>
      </>
    );
  }
  return (
    <>
      <path className="d2i-corner d2i-corner--tl" d="M2 5V2h3" />
      <path className="d2i-corner d2i-corner--tr" d="M11 2h3v3" />
      <path className="d2i-corner d2i-corner--br" d="M14 11v3h-3" />
      <path className="d2i-corner d2i-corner--bl" d="M5 14H2v-3" />
      <path className="d2i-mark" d="M8 4.5v4" />
      <Node className="d2i-node--accent" x={7} y={10} />
    </>
  );
}

/**
 * Decorative glyph. `playing` (re)plays its single motion verb once — remount with a new `key` to
 * replay. Under reduced motion the CSS swaps the motion for a static accent.
 */
export function D2Icon({ name, playing = false, size = 16 }: { name: IconName; playing?: boolean; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      className={`d2i d2i--${name}`}
      data-playing={playing ? "true" : "false"}
      focusable="false"
      height={size}
      style={{ "--d2i-size": `${size}px` } as CSSProperties}
      viewBox="0 0 16 16"
      width={size}
    >
      <Glyph name={name} />
    </svg>
  );
}
