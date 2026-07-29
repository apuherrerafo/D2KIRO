import type { SignalContribution, SignalId } from "@/features/draft/types";

// Exportado (TSK-032) para que ComparisonNote reutilice el mismo mapeo de nombres en vez de
// duplicarlo -- un cambio de etiqueta acá nunca debe poder desincronizarse con la comparación.
export const SIGNAL_LABELS: Record<SignalId, string> = {
  counter: "Contrapick",
  patch_meta: "Meta del parche",
  team_synergy: "Sinergia de equipo",
  role_gap: "Solapamiento de rol",
  hero_pool_fit: "Tu pool de héroes",
  role_safety: "Seguridad del pick temprano",
};

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

function SignalBreakdownRow({ signal }: SignalBreakdownRowProps) {
  if (signal.applicable === false) {
    return <SignalBreakdownRowNotApplicable signal={signal} />;
  }
  if (signal.raw === null) {
    return <SignalBreakdownRowEmpty signal={signal} />;
  }
  return (
    <li className="flex flex-col gap-0.5 text-caption">
      <div className="flex items-center justify-between text-content-secondary">
        <span>{SIGNAL_LABELS[signal.signal]}</span>
        <span>{signal.raw.toFixed(2)}</span>
      </div>
      <span className="text-content-muted">{signal.explanation}</span>
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
      {signals.map((signal) => (
        <SignalBreakdownRow key={signal.signal} signal={signal} />
      ))}
    </ul>
  );
}
