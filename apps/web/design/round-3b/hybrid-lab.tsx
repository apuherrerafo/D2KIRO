/* DS V1 · Round 3B — Hybrid motion skin. Same Round 3A motion behaviours (demo steps, perimeter
   routing, finite icon gestures, reduced-motion contract); new skin and object language.
   Raw <button>s are lab treatments under review, not product components. */
/* eslint-disable design-system/no-native-button */
import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useDemoSteps } from "../round-3a/lab-context";
import { PerimeterFrame, type PerimeterEdge } from "../round-3a/perimeter-frame";
import { D2Icon, ICONS, type IconName } from "./icons";

type Theme = "dark" | "light";

/* ───────── shared pieces ───────── */

function ReviewMark({ id }: { id: string }) {
  return <p className="r3b-review" data-review-target={id}>{id}: KEEP · MAYBE · NO</p>;
}

function SectionIntro({ eyebrow, title, children }: { children: ReactNode; eyebrow: string; title: string }) {
  return <header className="r3b-intro"><p>{eyebrow}</p><h1>{title}</h1><span>{children}</span></header>;
}

/** A play counter: every trigger remounts the glyph so its single verb plays once more. */
function usePlays() {
  const [plays, setPlays] = useState(0);
  const play = () => setPlays((current) => current + 1);
  return { play, plays };
}

function StepButtons({ labels, onStep, step }: { labels: string[]; onStep: (next: number) => void; step: number }) {
  return <div className="r3b-steps" role="group" aria-label="Estado de la demo">{labels.map((label, index) => <StepChoice active={index === step} index={index} key={label} label={label} onStep={onStep} />)}</div>;
}

function StepChoice({ active, index, label, onStep }: { active: boolean; index: number; label: string; onStep: (next: number) => void }) {
  const handleClick = () => onStep(index);
  return <button aria-pressed={active} className="r3b-step" onClick={handleClick} type="button">{label}</button>;
}

function Field({ children, className = "", theme }: { children: ReactNode; className?: string; theme?: Theme }) {
  return <div className={`r3b-field ${className}`} data-theme={theme}>{children}</div>;
}

/* ───────── 1 · overview ───────── */

const SPECTRAL_USES = [
  ["cambio de atención", "el cue viaja; nada más se tiñe"],
  ["cue en vivo", "un borde y un latido, sólo si el feed es real"],
  ["perímetro seleccionado", "el segmento que enruta la señal"],
  ["foco / activo", "el nodo acento del icono y el trazo de foco"],
  ["estela de movimiento", "rastro de un desplazamiento, luego nada"],
  ["presencia del coach", "experimental: el rombo de MOTION_02"],
];

const ANATOMY = [
  { id: "partial-edge", label: "borde parcial", note: "un solo lado dice dónde mirar" },
  { id: "brackets", label: "esquinas", note: "el contorno se insinúa, no se cierra" },
  { id: "segmented", label: "perímetro segmentado", note: "el camino de la señal, marcado por tramos" },
  { id: "notch", label: "muesca de estado", note: "el estado cuelga del borde, fuera del contenido" },
  { id: "rail", label: "riel de datos", note: "regla vertical con marcas en vez de caja" },
  { id: "delta-cell", label: "celda de delta", note: "el cambio vive al final, tras una regla" },
  { id: "index", label: "micro-índice", note: "numeración fuera del bloque, en el margen" },
];

function AnatomySpecimen({ id, label, note }: { id: string; label: string; note: string }) {
  return (
    <figure className="r3b-anatomy" data-anatomy={id}>
      <div aria-hidden="true" className={`r3b-anatomy-art r3b-anatomy-art--${id}`}><span>62%</span><i /></div>
      <figcaption><b>{label}</b><span>{note}</span></figcaption>
    </figure>
  );
}

export function HybridSkinOverview() {
  return (
    <div className="r3b-overview" data-testid="r3b-overview">
      <SectionIntro eyebrow="DS V1 / Round 3B / Hybrid Motion Skin" title="Misma gramática, otra piel.">
        Dirección <b>HYBRID</b> (decisión de Julio): estructura editorial y de datos, identidad espectral escasa, vidrio de presencia media, densidad operativa, energía de juego e iconografía propia. Los comportamientos de Round 3A no cambian: cambia la anatomía de lo que se mueve.
      </SectionIntro>
      <section className="r3b-overview-grid">
        <article className="r3b-roles" data-overview="type">
          <p className="r3b-kicker">roles tipográficos · Typography C</p>
          <p className="r3b-role-display">Abrir línea segura</p>
          <span className="r3b-role-note">Syne · display y acción</span>
          <p className="r3b-role-body">Tres señales coinciden: la línea se decide si eliges antes que el rival.</p>
          <span className="r3b-role-note">IBM Plex Sans · UI y cuerpo</span>
          <p className="r3b-role-data">62% · +2.4 · n=184 · edge.62</p>
          <span className="r3b-role-note">IBM Plex Mono · sólo datos y metadata</span>
          <p className="r3b-role-rule">Pixelify Sans queda fuera de todo valor crítico (62% se leía 68%). El pixel sobrevive como forma: nodos de 2×2, rejilla, textura.</p>
        </article>
        <Field className="r3b-material" theme="dark">
          <p className="r3b-kicker">escalera de material</p>
          <div className="r3b-material-stack" data-overview="glass">
            <div className="r3b-material-step r3b-material-step--field"><span>campo · trama de datos</span></div>
            <div className="r3b-material-step r3b-material-step--solid"><span>sólido · lectura densa</span></div>
            <div className="r3b-material-step r3b-glass"><span>vidrio medio · capa, foco, en vivo</span></div>
            <div className="r3b-material-step r3b-glass r3b-glass--edge"><span>vidrio + borde espectral · sólo lo activo</span></div>
          </div>
        </Field>
        <article className="r3b-spectral-uses" data-overview="spectral">
          <p className="r3b-kicker">espectro · seis usos, ninguno más</p>
          <ol>{SPECTRAL_USES.map(([use, rule], index) => <li key={use}><span className="r3b-index-inline">{String(index + 1).padStart(2, "0")}</span><b>{use}</b><span>{rule}</span></li>)}</ol>
        </article>
      </section>
      <section className="r3b-anatomy-grid" data-overview="anatomy">
        {ANATOMY.map((item) => <AnatomySpecimen id={item.id} key={item.id} label={item.label} note={item.note} />)}
      </section>
      <section className="r3b-verdict-section">
        <p className="r3b-kicker">revisión anti-genérica · ¿parece shadcn, SaaS de Tailwind, dashboard de IA, scaffold, dev-tool o panel cyber?</p>
        <AntiGenericTable />
      </section>
    </div>
  );
}

/* ───────── 2 · custom iconography ───────── */

function IconCard({ icon }: { icon: (typeof ICONS)[number] }) {
  const { play, plays } = usePlays();
  return (
    <article className="r3b-icon-card" data-icon-card={icon.name}>
      <div className="r3b-icon-stage">
        <span aria-hidden="true" className="r3b-icon-grid" />
        <D2Icon key={`hero-${plays}`} name={icon.name} playing={plays > 0} size={64} />
      </div>
      <div className="r3b-icon-sizes" aria-hidden="true">
        <D2Icon key={`s16-${plays}`} name={icon.name} playing={plays > 0} size={16} />
        <D2Icon key={`s20-${plays}`} name={icon.name} playing={plays > 0} size={20} />
        <D2Icon key={`s24-${plays}`} name={icon.name} playing={plays > 0} size={24} />
        <span>16 · 20 · 24</span>
      </div>
      <h2 className="r3b-icon-title">{icon.concept}</h2>
      <p className="r3b-icon-verb"><b>{icon.verb}</b> {icon.verbMeaning}</p>
      <p className="r3b-icon-construction">{icon.construction}</p>
      <button className="r3b-replay" onClick={play} onFocus={play} onPointerEnter={play} type="button">
        <D2Icon key={`btn-${plays}`} name={icon.name} playing={plays > 0} />
        <span>{icon.label}</span>
      </button>
    </article>
  );
}

export function CustomIconography() {
  return (
    <div data-testid="r3b-iconography">
      <SectionIntro eyebrow="DS V1 / Round 3B / Custom Iconography" title="Seis glifos, una construcción.">
        Rejilla de 16, trazo de 1.5, esquinas cortadas a 45°, nodos de dato de 2×2 y recintos siempre abiertos. Cada glifo tiene un solo verbo de movimiento y se detiene. Pasa el puntero, enfoca con teclado o haz clic en el botón de cada tarjeta: los tres disparan lo mismo.
      </SectionIntro>
      <div className="r3b-icon-cards">{ICONS.map((icon) => <IconCard icon={icon} key={icon.name} />)}</div>
      <ReviewMark id="CUSTOM_ICON_SYSTEM" />
    </div>
  );
}

/* ───────── 3 · semantic icon (MOTION_04) reskinned ───────── */

export const SKIN_ACTIONS: { data: string; icon: IconName; index: string; label: string; meta: string }[] = [
  { icon: "inspect", label: "Ver detalle", data: "n=184", meta: "evidencia · 6 señales", index: "01" },
  { icon: "live", label: "en vivo", data: "00:12", meta: "feed del simulador", index: "02" },
  { icon: "confirm", label: "Confirmar pick", data: "pick 3", meta: "turno propio · 3/5", index: "03" },
];
export const SKIN_STATES = ["reposo", "hover", "focus-visible", "active", "disabled"] as const;
export type SkinState = (typeof SKIN_STATES)[number];
const SKINS = [
  { id: "A", name: "Muesca + celda de dato", rule: "el icono vive en una muesca de vidrio con corte; el dato cuelga al final tras una regla; la regla inferior lleva la traza espectral al activar" },
  { id: "B", name: "Esquinas + micro-índice", rule: "sin caja: dos esquinas en reposo, cuatro al enfocar; el índice queda fuera del bloque" },
  { id: "C", name: "Riel de datos, dos líneas", rule: "regla vertical con marca; acción en Syne y metadata en mono debajo; el riel se ilumina al activar" },
] as const;

function SkinAnatomy({ action, playing, skin }: { action: (typeof SKIN_ACTIONS)[number]; playing: boolean; skin: string }) {
  if (skin === "A") {
    return (
      <>
        <span className="r3b-skin-notch"><D2Icon name={action.icon} playing={playing} /></span>
        <span className="r3b-skin-label">{action.label}</span>
        <span className="r3b-skin-data">{action.data}</span>
      </>
    );
  }
  if (skin === "B") {
    return (
      <>
        <span aria-hidden="true" className="r3b-skin-index">{action.index}</span>
        <D2Icon name={action.icon} playing={playing} />
        <span className="r3b-skin-label">{action.label}</span>
        <span aria-hidden="true" className="r3b-skin-brackets"><i /><i /><i /><i /></span>
      </>
    );
  }
  return (
    <>
      <span aria-hidden="true" className="r3b-skin-rail" />
      <D2Icon name={action.icon} playing={playing} />
      <span className="r3b-skin-text"><span className="r3b-skin-label">{action.label}</span><span className="r3b-skin-meta">{action.meta}</span></span>
    </>
  );
}

export function SkinControl({ action, replay, skin, state }: { action: (typeof SKIN_ACTIONS)[number]; replay: number; skin: string; state: SkinState }) {
  const { play, plays } = usePlays();
  const forced = state === "reposo" || state === "disabled" ? undefined : state;
  const playing = forced !== undefined || plays > 0;
  return (
    <button
      className={`r3b-skin r3b-skin--${skin.toLowerCase()}`}
      data-forced={forced}
      data-skin-state={state}
      disabled={state === "disabled"}
      onClick={play}
      onFocus={play}
      onPointerEnter={play}
      type="button"
    >
      <SkinAnatomy action={action} key={`${forced ? replay : "rest"}-${plays}`} playing={playing} skin={skin} />
    </button>
  );
}

function SkinMatrix({ replay, skin }: { replay: number; skin: (typeof SKINS)[number] }) {
  return (
    <article className="r3b-skin-block" data-icon-skin={skin.id}>
      <header className="r3b-block-head"><span className="r3b-block-id">ICON_SKIN_{skin.id}</span><h2>{skin.name}</h2></header>
      <p className="r3b-block-rule">{skin.rule}</p>
      <div className="r3b-skin-matrix" role="table" aria-label={`Estados de ICON_SKIN_${skin.id}`}>
        <div className="r3b-skin-row" role="row"><span className="r3b-sr" role="columnheader">acción</span>{SKIN_STATES.map((state) => <span className="r3b-skin-colhead" key={state} role="columnheader">{state}</span>)}</div>
        {SKIN_ACTIONS.map((action) => (
          <div className="r3b-skin-row" key={action.icon} role="row">
            <span className="r3b-sr" role="rowheader">{action.label}</span>
            {SKIN_STATES.map((state) => <span key={state} role="cell"><SkinControl action={action} replay={replay} skin={skin.id} state={state} /></span>)}
          </div>
        ))}
      </div>
      <ReviewMark id={`ICON_SKIN_${skin.id}`} />
    </article>
  );
}

export function SemanticIconReskinned() {
  const host = useRef<HTMLDivElement>(null);
  const { step } = useDemoSteps(1000, 2600, host);
  return (
    <div data-testid="r3b-icon-skins" ref={host}>
      <SectionIntro eyebrow="DS V1 / Round 3B / Semantic Icon — reskin (MOTION_04)" title="Tres anatomías, un mismo lenguaje.">
        Misma lógica de MOTION_04: hover, foco y activo disparan un gesto finito del icono. No son direcciones visuales: son tres maneras de componer icono, acción y dato dentro de HYBRID, sin la fila rectangular con borde completo.
      </SectionIntro>
      <div className="r3b-skin-blocks">{SKINS.map((skin) => <SkinMatrix key={skin.id} replay={step} skin={skin} />)}</div>
    </div>
  );
}

/* ───────── 4 · live state (MOTION_05) reskinned ───────── */

const LIVE_STEPS = ["Reposo", "En vivo", "Atención", "Estable"];
const LIVE_IDS = ["idle", "live", "attention", "stable"] as const;
const LIVE_CONTENT = [
  { status: "sin señal", value: "—", delta: "—", dir: "flat" },
  { status: "en vivo", value: "62%", delta: "+2.4", dir: "up" },
  { status: "cambio +2", value: "64%", delta: "+2.6", dir: "up" },
  { status: "en vivo · estable", value: "64%", delta: "+2.6", dir: "up" },
];

/* DS V1.1 · `canonical` renders the same module with the canonical data grammar and glass level B
   (Julio circled `conf. media · edge.62` as wrong). The default keeps this Round 3B study untouched. */
const LIVE_CANONICAL = [
  { status: "Sin señal", value: "—", delta: "—", meta: "Esperando el primer pick" },
  { status: "En vivo", value: "62%", delta: "+2,4", meta: "Ventaja del pick · confianza media" },
  { status: "Cambio +2", value: "64%", delta: "+2,6", meta: "Ventaja del pick · confianza media" },
  { status: "Estable", value: "64%", delta: "+2,6", meta: "Ventaja del pick · confianza media" },
];

export type LiveOverride = { delta: string; dir: "up" | "down"; meta: string; status: string; value: string };

/* Motion Canonical V1 drives this canonical surface with its own data and its own one-shot carriers:
   `override` replaces the step copy, `pulse` replaces the step-derived glyph pulse. Both are opt-in. */
export function LiveModule({ canonical = false, override, pulse, source, step }: { canonical?: boolean; override?: LiveOverride; pulse?: boolean; source: "strategic" | "default"; step: number }) {
  const lab = LIVE_CONTENT[step];
  const canon = LIVE_CANONICAL[step];
  const base = canonical ? { ...lab, ...canon } : { ...lab, meta: "conf. media · edge.62" };
  const content = override ? { ...base, ...override } : base;
  const pulsing = pulse ?? (source === "strategic" && (step === 1 || step === 2));
  return (
    <div className="r3b-live" data-canon={canonical ? "true" : undefined} data-live-step={LIVE_IDS[step]} data-source={source}>
      <span aria-hidden="true" className="r3b-live-bloom" />
      <span aria-hidden="true" className="r3b-ghost">62</span>
      <span className="r3b-notch r3b-live-notch">
        <D2Icon key={`live-${step}`} name="live" playing={pulsing} size={14} />
        <span>{content.status}</span>
      </span>
      <div className={canonical ? "r3b-glass r3b-live-glass cx-glass" : "r3b-glass r3b-live-glass"} data-glass-level={canonical ? "b" : undefined}>
        <span aria-hidden="true" className="r3b-live-cue" />
        <b className="r3b-live-value" data-motion-part="value" key={`value-${step}`}>{content.value}</b>
        <span className="r3b-live-meta">{content.meta}</span>
        <span className="r3b-live-delta" data-dir={content.dir}>{content.delta}</span>
        <span aria-hidden="true" className="r3b-live-sweep" data-motion-part="sweep" key={`sweep-${step}`} />
      </div>
      <span className="r3b-live-source">{source === "strategic" ? "estratégica" : "por defecto"}</span>
    </div>
  );
}

function LiveDemo({ label }: { label?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const { setStep, step } = useDemoSteps(LIVE_STEPS.length, 1900, host);
  const [source, setSource] = useState<"strategic" | "default">("strategic");
  const chooseStrategic = () => setSource("strategic");
  const chooseDefault = () => setSource("default");
  return (
    <div className="r3b-demo" ref={host}>
      {label ? <p className="r3b-kicker">{label}</p> : null}
      <Field><LiveModule source={source} step={step} /></Field>
      <StepButtons labels={LIVE_STEPS} onStep={setStep} step={step} />
      <div className="r3b-steps" role="group" aria-label="Fuente de la recomendación">
        <button aria-pressed={source === "strategic"} className="r3b-step" onClick={chooseStrategic} type="button">Estratégica</button>
        <button aria-pressed={source === "default"} className="r3b-step" onClick={chooseDefault} type="button">Por defecto</button>
      </div>
    </div>
  );
}

export function LiveStateReskinned() {
  return (
    <div data-testid="r3b-live">
      <SectionIntro eyebrow="DS V1 / Round 3B / Live State — reskin (MOTION_05)" title="En vivo, sin tarjeta.">
        Misma secuencia de MOTION_05 (reposo → en vivo → atención → estable). El estado cuelga como muesca de vidrio, el valor manda, el delta vive en su celda final, y el espectro aparece sólo como borde, latido y barrido. «Por defecto» se queda neutro: sin brillo, sin latido, sin espectro.
      </SectionIntro>
      <LiveDemo />
      <ReviewMark id="LIVE_STATE_SKIN" />
    </div>
  );
}

/* ───────── 5 · perimeter travel (MOTION_08) reskinned ───────── */

type RouteStep = { edge: PerimeterEdge | null; label: string; target: string };

function useRoute(steps: RouteStep[], interval: number) {
  const host = useRef<HTMLDivElement>(null);
  const { setStep, step } = useDemoSteps(steps.length, interval, host);
  const [pulse, setPulse] = useState({ count: 0, step });
  if (pulse.step !== step) setPulse({ count: pulse.count + 1, step });
  return { host, pulse: pulse.count, setStep, step, target: steps[step].target, edge: steps[step].edge };
}

function on(target: string, key: string) {
  return target === key ? "true" : "false";
}

const ROUTE_A: RouteStep[] = [
  { edge: null, label: "Reposo", target: "" },
  { edge: "left", label: "Tu turno", target: "turn" },
  { edge: "right", label: "Rival", target: "rival" },
  { edge: "bottom", label: "Evidencia", target: "evidence" },
];

export function PerimeterLayoutA() {
  const { edge, host, pulse, setStep, step, target } = useRoute(ROUTE_A, 2000);
  return (
    <div className="r3b-demo" ref={host}>
      <PerimeterFrame className="r3b-pl r3b-pl--a" edge={edge} label="Fila densa con señal enrutada" pulse={pulse} rest="corners">
        <span className="r3b-pl-index">07</span>
        <span className="r3b-pl-turn" data-on={on(target, "turn")}>Tu turno</span>
        <b className="r3b-pl-value">62%</b>
        <span className="r3b-pl-delta" data-dir="up">+2.4</span>
        <span className="r3b-pl-meta" data-on={on(target, "evidence")}>conf. media · n=184</span>
        <span className="r3b-pl-rival" data-on={on(target, "rival")}>Rival <small>pos 2</small></span>
      </PerimeterFrame>
      <StepButtons labels={ROUTE_A.map((route) => route.label)} onStep={setStep} step={step} />
    </div>
  );
}

const ROUTE_B: RouteStep[] = [
  { edge: null, label: "Reposo", target: "" },
  { edge: "top", label: "Tu turno", target: "turn" },
  { edge: "right", label: "Rival", target: "rival" },
  { edge: "bottom", label: "Evidencia", target: "evidence" },
];

export function PerimeterLayoutB() {
  const { edge, host, pulse, setStep, step, target } = useRoute(ROUTE_B, 2100);
  return (
    <div className="r3b-demo" ref={host}>
      <PerimeterFrame className="r3b-pl r3b-pl--b" edge={edge} label="Valor principal con riel de metadata" pulse={pulse} rest="corners">
        <span className="r3b-notch r3b-pl-notch" data-on={on(target, "turn")}><D2Icon name="live" size={12} />Tu turno · pick 07</span>
        <div className="r3b-pl-main">
          <span className="r3b-pl-caption">edge del pick</span>
          <b className="r3b-pl-big">62%</b>
          <span className="r3b-pl-delta" data-dir="up">+2.4</span>
        </div>
        <dl className="r3b-pl-rail">
          <div data-on={on(target, "rival")}><dt>rival</dt><dd>pos 2 · revela</dd></div>
          <div><dt>conf.</dt><dd>media</dd></div>
          <div data-on={on(target, "evidence")}><dt>n</dt><dd>184 · 00:12</dd></div>
          <div><dt>señal</dt><dd>edge.62</dd></div>
        </dl>
      </PerimeterFrame>
      <StepButtons labels={ROUTE_B.map((route) => route.label)} onStep={setStep} step={step} />
    </div>
  );
}

const ROUTE_C: RouteStep[] = [
  { edge: null, label: "Reposo", target: "" },
  { edge: "left", label: "Tu lado", target: "own" },
  { edge: "right", label: "Rival", target: "rival" },
  { edge: "bottom", label: "Evidencia", target: "evidence" },
];
export const OPS_ROWS: { label: string; own: string; ownBar?: number; ownDir?: "up"; rival: string; rivalBar?: number }[] = [
  { label: "edge", own: "62%", ownBar: 62, rival: "38%", rivalBar: 38 },
  { label: "delta", own: "+2.4", ownDir: "up", rival: "−2.4" },
  { label: "conf.", own: "media", rival: "baja" },
  { label: "pool", own: "06/10", rival: "—" },
];

export function PerimeterLayoutC() {
  const { edge, host, pulse, setStep, step, target } = useRoute(ROUTE_C, 2200);
  return (
    <div className="r3b-demo" ref={host}>
      <PerimeterFrame className="r3b-pl r3b-pl--c" edge={edge} label="Bloque operativo en dos columnas" pulse={pulse} rest="corners">
        <table className="r3b-vs">
          <thead><tr><th className="r3b-vs-own" data-on={on(target, "own")} scope="col">Tu lado</th><th className="r3b-vs-mid" scope="col">vs</th><th className="r3b-vs-rival" data-on={on(target, "rival")} scope="col">Rival</th></tr></thead>
          <tbody>{OPS_ROWS.map((row) => <OpsRow key={row.label} row={row} target={target} />)}</tbody>
        </table>
        <p className="r3b-ops-foot" data-on={on(target, "evidence")}>n=184 · actualizado 00:12 · edge.62</p>
      </PerimeterFrame>
      <StepButtons labels={ROUTE_C.map((route) => route.label)} onStep={setStep} step={step} />
    </div>
  );
}

export function OpsRow({ row, target }: { row: (typeof OPS_ROWS)[number]; target: string }) {
  return (
    <tr>
      <td className="r3b-vs-own" data-dir={row.ownDir} data-on={on(target, "own")}>
        {row.ownBar ? <i aria-hidden="true" className="r3b-vs-bar" style={{ "--w": row.ownBar } as CSSProperties} /> : null}
        <span>{row.own}</span>
      </td>
      <th className="r3b-vs-mid" scope="row">{row.label}</th>
      <td className="r3b-vs-rival" data-on={on(target, "rival")}>
        {row.rivalBar ? <i aria-hidden="true" className="r3b-vs-bar" style={{ "--w": row.rivalBar } as CSSProperties} /> : null}
        <span>{row.rival}</span>
      </td>
    </tr>
  );
}

const LAYOUTS = [
  { id: "A", title: "Fila densa única", rule: "una fila de 36 px: izquierda = tu turno, derecha = rival, abajo = evidencia", render: () => <PerimeterLayoutA /> },
  { id: "B", title: "Valor + riel de metadata", rule: "arriba = turno (muesca), derecha = riel, abajo = evidencia", render: () => <PerimeterLayoutB /> },
  { id: "C", title: "Bloque operativo en dos columnas", rule: "comparación espejada: el dato al centro, tu lado crece hacia la izquierda y el rival hacia la derecha; izquierda = tu lado, derecha = rival, abajo = evidencia", render: () => <PerimeterLayoutC /> },
];

export function PerimeterTravelReskinned() {
  return (
    <div data-testid="r3b-perimeter">
      <SectionIntro eyebrow="DS V1 / Round 3B / Perimeter Travel — reskin (MOTION_08)" title="La señal llega a un dato, no a un borde.">
        Mismo enrutamiento de MOTION_08, ahora sin caja: el reposo son cuatro esquinas, el camino está implícito. Cuando la señal llega a un borde, el dato conectado se enciende con un nodo de 2×2. En reposo nada se mueve.
      </SectionIntro>
      <div className="r3b-layouts">{LAYOUTS.map((layout) => <LayoutBlock key={layout.id} layout={layout} />)}</div>
    </div>
  );
}

function LayoutBlock({ layout }: { layout: (typeof LAYOUTS)[number] }) {
  return (
    <article className="r3b-layout" data-perimeter-layout={layout.id}>
      <header className="r3b-block-head"><span className="r3b-block-id">PERIMETER_LAYOUT_{layout.id}</span><h2>{layout.title}</h2></header>
      <Field>{layout.render()}</Field>
      <p className="r3b-block-rule">{layout.rule}</p>
      <ReviewMark id={`PERIMETER_LAYOUT_${layout.id}`} />
    </article>
  );
}

/* ───────── 6 · compact data module ───────── */

function CompactMeta({ canonical }: { canonical: boolean }) {
  if (canonical) return <span className="r3b-cdm-meta">Ventaja del pick<br />Confianza media · 184 partidas</span>;
  return <span className="r3b-cdm-meta">conf. media<br />n=184 · edge.62</span>;
}

/* DS V1.1 · `canonical` = same module with the canonical data grammar, glass level B and the canonical
   Primary passed in through `primary` (the lab keeps its own 3B cut action by default). */
export function CompactModule({ canonical = false, primary }: { canonical?: boolean; primary?: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const { setStep, step } = useDemoSteps(2, 2600, host);
  const { play, plays } = usePlays();
  const selected = step === 1;
  const toggle = () => setStep(selected ? 0 : 1);
  const labAction = <button className="r3b-action" onClick={play} type="button">Analizar draft<D2Icon key={`confirm-${plays}`} name="confirm" playing={plays > 0} /></button>;
  return (
    <div className="r3b-demo" ref={host}>
      <article className="r3b-cdm" data-canon={canonical ? "true" : undefined} data-selected={selected ? "true" : "false"}>
        <span aria-hidden="true" className="r3b-cdm-index">01<i /></span>
        <PerimeterFrame className="r3b-cdm-frame" edge={selected ? "left" : null} label="Módulo de datos compacto" rest="corners">
          <span aria-hidden="true" className="r3b-cdm-bloom" />
          <span aria-hidden="true" className="r3b-ghost">62</span>
          <div className={canonical ? "r3b-glass r3b-cdm-glass cx-glass" : "r3b-glass r3b-cdm-glass"} data-glass-level={canonical ? "b" : undefined}>
            <span className="r3b-notch r3b-cdm-notch">{canonical ? "Estratégica" : "estratégica"}</span>
            <h2 className="r3b-cdm-title"><D2Icon key={`signal-${step}`} name="signal" playing={selected} size={18} />Abrir línea segura</h2>
            <p className="r3b-cdm-body">Tres señales coinciden si eliges antes que el rival.</p>
            <div className="r3b-cdm-data">
              <b>62%</b>
              <span className="r3b-cdm-delta" data-dir="up">{canonical ? "+2,4" : "+2.4"}</span>
              <CompactMeta canonical={canonical} />
            </div>
            <div className="r3b-cdm-actions">
              {primary ?? labAction}
              <button aria-pressed={selected} className="r3b-quiet" onClick={toggle} type="button"><D2Icon key={`inspect-${step}`} name="inspect" playing={selected} />{selected ? "En foco" : "Fijar foco"}</button>
            </div>
          </div>
        </PerimeterFrame>
      </article>
    </div>
  );
}

export function CompactDataModuleStudy() {
  return (
    <div data-testid="r3b-module">
      <SectionIntro eyebrow="DS V1 / Round 3B / Compact Data Module" title="Una tesis visual, no un componente.">
        Icono propio, título y acción en Syne, cuerpo en Plex Sans, datos en Plex Mono, vidrio medio, fragmento de perímetro, delta y microdato, en un módulo pequeño. «Fijar foco» enruta la señal; «Analizar draft» cierra el glifo de confirmar.
      </SectionIntro>
      <Field className="r3b-module-field"><CompactModule /></Field>
      <ReviewMark id="COMPACT_DATA_MODULE" />
    </div>
  );
}

/* ───────── 7 · light / dark ───────── */

function ThemeColumn({ theme }: { theme: Theme }) {
  return (
    <section className="r3b-theme-col" data-theme={theme} data-theme-column={theme}>
      <p className="r3b-kicker">{theme === "dark" ? "oscuro" : "claro"}</p>
      <LiveDemo />
      <Field><PerimeterLayoutB /></Field>
      <Field><CompactModule /></Field>
      <div className="r3b-theme-skins">{SKINS.map((skin) => <SkinControl action={SKIN_ACTIONS[0]} key={skin.id} replay={0} skin={skin.id} state="reposo" />)}</div>
    </section>
  );
}

export function LightDarkComparison() {
  return (
    <div data-testid="r3b-themes">
      <SectionIntro eyebrow="DS V1 / Round 3B / Light + Dark" title="El mismo material de día y de noche.">
        El vidrio claro es blanco teñido con borde interior y sombra corta; el espectro usa paradas más profundas para mantener contraste. Las mismas piezas, la misma lógica.
      </SectionIntro>
      <div className="r3b-theme-pair"><ThemeColumn theme="dark" /><ThemeColumn theme="light" /></div>
    </div>
  );
}

/* ───────── anti-generic review (filled after visual review, see ROUND_3B_REVIEW.md) ───────── */

export const ANTI_GENERIC: { id: string; verdict: "PASS" | "PARTIAL" | "FAIL"; why: string }[] = [
  { id: "CUSTOM_ICON_SYSTEM", verdict: "PASS", why: "construcción propia (cortes a 45°, nodos 2×2, recintos abiertos); «confirmar» sigue siendo el más cercano a un check genérico" },
  { id: "ICON_SKIN_A", verdict: "PARTIAL", why: "muesca con corte y celda de dato ayudan, pero de lejos aún se lee como botón de icono en baldosa (patrón shadcn/sidebar)" },
  { id: "ICON_SKIN_B", verdict: "PASS", why: "sin caja, esquinas + índice externo; riesgo de HUD sólo si las esquinas se usan en todo" },
  { id: "ICON_SKIN_C", verdict: "PARTIAL", why: "el riel y la meta en mono ayudan, pero la forma de dos líneas recuerda a un ítem de lista de sidebar genérico" },
  { id: "LIVE_STATE_SKIN", verdict: "PASS", why: "muesca colgante, cue espectral, celda de delta y numeral fantasma bajo vidrio; no es una tarjeta" },
  { id: "PERIMETER_LAYOUT_A", verdict: "PASS", why: "fila sin caja, esquinas implícitas, la señal llega a un dato concreto" },
  { id: "PERIMETER_LAYOUT_B", verdict: "PASS", why: "escala editorial (valor grande) + riel de metadata + muesca de turno" },
  { id: "PERIMETER_LAYOUT_C", verdict: "PASS", why: "revisado: de tabla genérica a comparación espejada con barras desde el centro (gramática de transmisión deportiva)" },
  { id: "COMPACT_DATA_MODULE", verdict: "PASS", why: "sigue siendo un rectángulo de vidrio, justificado como capa; índice externo, muesca, esquinas, acción con corte y numeral fantasma lo sacan del card genérico" },
];

export function AntiGenericTable() {
  return (
    <table className="r3b-verdicts" data-anti-generic="round-3b">
      <thead><tr><th scope="col">estudio</th><th scope="col">veredicto</th><th scope="col">por qué</th></tr></thead>
      <tbody>{ANTI_GENERIC.map((row) => <VerdictRow key={row.id} row={row} />)}</tbody>
    </table>
  );
}

function VerdictRow({ row }: { row: (typeof ANTI_GENERIC)[number] }) {
  return <tr data-verdict={row.verdict}><th scope="row">{row.id}</th><td>{row.verdict}</td><td>{row.why}</td></tr>;
}
