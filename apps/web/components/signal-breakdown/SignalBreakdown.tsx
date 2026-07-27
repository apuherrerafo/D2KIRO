import type { SignalContribution, SignalId } from "@/features/draft/types";

const SIGNAL_LABELS: Record<SignalId, string> = {
  counter: "Contrapick",
  patch_meta: "Meta del parche",
  team_synergy: "Sinergia de equipo",
  role_gap: "Solapamiento de rol",
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

function SignalBreakdownRow({ signal }: SignalBreakdownRowProps) {
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

// Muestra las 4 señales de una sugerencia, incluidas las que dieron `null` -- nunca se calla una
// señal sin dato, se marca honestamente (criterio de aceptación del ticket).
export function SignalBreakdown({ signals }: SignalBreakdownProps) {
  return (
    <ul className="flex flex-col gap-2">
      {signals.map((signal) => (
        <SignalBreakdownRow key={signal.signal} signal={signal} />
      ))}
    </ul>
  );
}
