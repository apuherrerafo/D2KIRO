// <Dominio><Cosa>: la línea que le dice al jugador QUÉ HACER AHORA en el simulador. Antes la pantalla
// mostraba consejos pero nunca una instrucción ("¿y yo qué hago?"): cuántos héroes elegir en esta
// ronda y qué pasa después. Sólo lee la ronda y la capacidad que el motor ya calcula
// (`humanActionability.roundCapacity`); no decide nada por su cuenta.

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
      <div className="flex flex-col gap-1 rounded-lg border border-surface-border bg-surface-raised p-3" role="status" data-testid="round-instruction" data-round={round}>
        <span className="text-heading text-content-primary">Ronda {round} terminada · Mira lo que eligió el rival</span>
        <span className="text-caption text-content-secondary">Con eso a la vista, la siguiente ronda se juega con más información.</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-accent-primary bg-surface-raised p-3" role="status" data-testid="round-instruction" data-round={round}>
      <span className="text-heading text-content-primary">
        Ronda {round} de {TOTAL_ROUNDS} · {pickInstruction(capacity)}
      </span>
      <span className="text-caption text-content-secondary">
        Tus picks quedan sellados: el rival los ve recién cuando termina la ronda. Toca un héroe recomendado, o usa «Buscar otro héroe» si quieres uno que el coach no propuso.
      </span>
    </div>
  );
}
