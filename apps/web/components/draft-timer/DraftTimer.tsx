"use client";

import { useEffect, useState } from "react";

interface DraftTimerProps {
  waitMs: number;
}

const TICK_MS = 100;

function barColorClassName(remainingMs: number, totalMs: number): string {
  const share = totalMs > 0 ? remainingMs / totalMs : 0;
  if (share <= 0.2) return "bg-signal-negative";
  if (share <= 0.5) return "bg-signal-warning";
  return "bg-accent-primary";
}

// <Dominio><Cosa>: contador regresivo visual mientras el simulador espera el próximo pick
// (TSK-035) -- sincroniza con tiempo real vía setInterval, caso legítimo de useEffect (no es
// estado derivable en render). El padre lo remonta con un `key` distinto en cada espera nueva
// (nunca confía en que `waitMs` cambie de valor -- dos picks seguidos pueden tener el mismo
// delayMs, ej. 3000ms en captainsMode, y el timer igual debe reiniciar).
export function DraftTimer({ waitMs }: DraftTimerProps) {
  const [remainingMs, setRemainingMs] = useState(waitMs);

  useEffect(() => {
    const startedAt = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      setRemainingMs(Math.max(0, waitMs - elapsed));
    }, TICK_MS);
    return () => clearInterval(interval);
  }, [waitMs]);

  const seconds = Math.ceil(remainingMs / 1000);
  const percentRemaining = waitMs > 0 ? (remainingMs / waitMs) * 100 : 0;

  return (
    <div className="flex flex-col items-center gap-1 rounded-lg border border-surface-border bg-surface-raised px-4 py-2">
      <span className="text-display tabular-nums text-content-primary">{seconds}s</span>
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-overlay">
        <div
          className={`h-full rounded-full transition-[width] ${barColorClassName(remainingMs, waitMs)}`}
          style={{ width: `${percentRemaining}%` }}
        />
      </div>
    </div>
  );
}
