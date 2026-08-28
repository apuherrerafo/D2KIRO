import { SIGNAL_DISPLAY_PRIORITY } from "@/features/draft/constants";
import type { SignalContribution, SignalId } from "@/features/draft/types";

// Exportado (TSK-032) para que ComparisonNote reutilice el mismo mapeo de nombres en vez de
// duplicarlo -- un cambio de etiqueta acá nunca debe poder desincronizarse con la comparación.
export const SIGNAL_LABELS: Record<SignalId, string> = {
  counter: "Contrapick",
  patch_meta: "Meta del parche",
  team_synergy: "Sinergia de equipo",
  hero_pool_fit: "Tu pool de héroes",
  position_fit: "Posición y momento del pick",
  // TSK-180 (Fase 4.2): sin intención elegida, esta fila cae en SignalBreakdownRowNotApplicable
  // con el texto del motor ("Elegí una intención de draft para activar esta señal"), nunca el de
  // "Sin datos suficientes" (exclusivo de raw: null).
  archetype_fit: "Intención de draft",
};

// TSK-077 (spec §1.3): pura, exportada para probarla sin renderizar nada -- reordena solo la
// PRESENTACIÓN (SIGNAL_DISPLAY_PRIORITY, constants.tsx). El array que llega por `signals` (orden
// de wire real del motor) no se muta -- se copia antes de ordenar.
export function sortByPriority(signals: SignalContribution[]): SignalContribution[] {
  return [...signals].sort(
    (a, b) => SIGNAL_DISPLAY_PRIORITY.indexOf(a.signal) - SIGNAL_DISPLAY_PRIORITY.indexOf(b.signal),
  );
}

interface SignalBreakdownRowProps {
  signal: SignalContribution;
}

function SignalBreakdownRowEmpty({ signal }: SignalBreakdownRowProps) {
  return (
    <li className="flex items-center justify-between text-caption text-content-muted">
      <span>{SIGNAL_LABELS[signal.signal]}</span>
      <span>Sin datos suficientes</span>
    </li>
  );
}

// TSK-026 (fase 1b): `applicable: false` ("no configuraste el pool") es un caso distinto de
// `raw: null` ("hay hueco de datos") -- fila propia, nunca el mismo texto de "sin datos
// suficientes". Confundirlos reintroduce el problema que `applicable` existe para evitar.
function SignalBreakdownRowNotApplicable({ signal }: SignalBreakdownRowProps) {
  return (
    <li className="flex flex-col gap-0.5 text-caption">
      <span className="text-content-muted">{SIGNAL_LABELS[signal.signal]}</span>
      <span className="text-content-muted">{signal.explanation}</span>
    </li>
  );
}

// TSK-077 (spec §1.3): antes, el número crudo (`raw.toFixed(2)`) y la explicación tenían el mismo
// peso visual en cada fila -- lo primero que se leía era una tabla de números, no una narrativa
// táctica. Ahora la `explanation` (el texto real, "Aporta initiation...", "Fuerte contra X") es
// la primera línea, con el tamaño de cuerpo normal; la etiqueta de la señal y su número crudo
// bajan a una segunda línea, en `text-caption` muted -- sigue siendo visible (nunca se oculta un
// dato, regla dura de fase 1b/3), solo deja de competir por atención con lo que importa.
function SignalBreakdownRow({ signal }: SignalBreakdownRowProps) {
  if (signal.applicable === false) {
    return <SignalBreakdownRowNotApplicable signal={signal} />;
  }
  if (signal.raw === null) {
    return <SignalBreakdownRowEmpty signal={signal} />;
  }
  return (
    <li className="flex flex-col gap-0.5">
      <span className="text-caption text-content-secondary">{signal.explanation}</span>
      <div className="flex items-center justify-between text-caption text-content-muted">
        <span>{SIGNAL_LABELS[signal.signal]}</span>
        <span className="tabular-nums">{signal.raw.toFixed(2)}</span>
      </div>
    </li>
  );
}

interface SignalBreakdownProps {
  signals: SignalContribution[];
}

// Muestra las 5 señales de una sugerencia (fase 1b), incluidas las que dieron `null` o
// `applicable: false` -- nunca se calla una señal sin dato ni una que no aplica, cada una se
// marca honestamente y de forma distinta (criterio de aceptación del ticket).
export function SignalBreakdown({ signals }: SignalBreakdownProps) {
  return (
    <ul className="flex flex-col gap-2">
      {sortByPriority(signals).map((signal) => (
        <SignalBreakdownRow key={signal.signal} signal={signal} />
      ))}
    </ul>
  );
}
