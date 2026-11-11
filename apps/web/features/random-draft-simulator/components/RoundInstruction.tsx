// <Dominio><Cosa>: la línea que le dice al jugador QUÉ HACER AHORA en el simulador: la ronda, cuántos héroes elegir y cómo se elige.
// Sólo lee la ronda y la capacidad que el motor ya calcula (`humanActionability.roundCapacity`); no decide nada por su cuenta.

interface RoundInstructionProps {
  round: 1 | 2 | 3;
  /** Cuántos picks caben ahora (motor). `null` mientras el motor todavía no lo informó. */
  capacity: number | null;
  /** La ronda ya cerró: toca mirar lo que eligió el rival. */
  revealed: boolean;
}

const TOTAL_ROUNDS = 3;

function pickInstruction(capacity: number | null): string {
  if (capacity === null) return "Elige tus héroes";
  if (capacity === 1) return "Elige 1 héroe";
  return `Elige ${capacity} héroes`;
}

export function RoundInstruction({ round, capacity, revealed }: RoundInstructionProps) {
  if (revealed) {
    return (
      <div className="sl-round-head" role="status" data-testid="round-instruction" data-round={round}>
        <span className="sl-round-title">Ronda {round} terminada · Mira lo que eligió el rival</span>
        <span className="sl-muted">Con eso a la vista, la siguiente ronda se juega con más información.</span>
      </div>
    );
  }
  return (
    <div className="sl-round-head" role="status" data-testid="round-instruction" data-round={round}>
      <span className="sl-round-title" data-testid="round-capacity" data-round-capacity={capacity ?? undefined}>
        Ronda {round} de {TOTAL_ROUNDS} · {pickInstruction(capacity)}
      </span>
      <span className="sl-muted">
        Toca un héroe para ver por qué se recomienda y pulsa «Elegir» para confirmarlo, o busca cualquier otro héroe legal. Tus picks quedan sellados: el rival los ve recién cuando termina la ronda.
      </span>
    </div>
  );
}
