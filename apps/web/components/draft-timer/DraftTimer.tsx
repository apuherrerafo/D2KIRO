"use client";

import { useEffect, useState } from "react";

interface DraftTimerProps {
  waitMs: number;
  // TSK-074 (spec §2.4): cuando se pasa, el countdown resta el tiempo YA transcurrido desde este
  // ISO real en vez de asumir que el turno arranca recién ahora -- necesario para un turno real
  // de Captain's Mode (reconectar a mitad de turno, o simplemente que el mensaje tarde en
  // llegar, no debe reiniciar el reloj desde cero). Ausente = comportamiento exacto de siempre
  // (el simulador sigue remontando por `key` para reiniciar, sin tocar este prop).
  startedAt?: string;
}

const TICK_MS = 100;

function barColorClassName(remainingMs: number, totalMs: number): string {
  const share = totalMs > 0 ? remainingMs / totalMs : 0;
  if (share <= 0.2) return "bg-signal-negative";
  if (share <= 0.5) return "bg-signal-warning";
  return "bg-accent-primary";
}

// Pura, exportada para probarla sin montar nada -- separa "cuánto queda" de cómo se dibuja.
export function computeRemainingMs(waitMs: number, startedAtMs: number, nowMs: number): number {
  return Math.max(0, waitMs - (nowMs - startedAtMs));
}

// <Dominio><Cosa>: contador regresivo visual -- mismo componente para el guion del simulador
// (TSK-035, sin `startedAt`, remontado por `key` en cada espera nueva) y para un turno real de
// Captain's Mode (TSK-074, con `startedAt` = DraftState.turnStartedAt real). Sincroniza con
// tiempo real vía setInterval, caso legítimo de useEffect (no es estado derivable en render).
export function DraftTimer({ waitMs, startedAt }: DraftTimerProps) {
  // startedAtMs se calcula dentro del inicializador perezoso -- React solo lo llama al montar,
  // nunca en cada render, así que Date.now()/new Date() nunca se invoca en el cuerpo del render
  // (hallazgo real de la nueva regla react-hooks/purity, TSK-118).
  const [remainingMs, setRemainingMs] = useState(() => {
    const startedAtMs = startedAt ? new Date(startedAt).getTime() : Date.now();
    return computeRemainingMs(waitMs, startedAtMs, Date.now());
  });

  useEffect(() => {
    const effectStartedAtMs = startedAt ? new Date(startedAt).getTime() : Date.now();
    const interval = setInterval(() => {
      setRemainingMs(computeRemainingMs(waitMs, effectStartedAtMs, Date.now()));
    }, TICK_MS);
    return () => clearInterval(interval);
  }, [waitMs, startedAt]);

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
