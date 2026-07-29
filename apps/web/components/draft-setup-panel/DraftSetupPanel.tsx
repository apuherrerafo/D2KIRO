"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { postSimulatorEvent } from "@/features/draft/manual-entry";
import { buildSimulatorEnvelopes, runSimulatorPlayback, type SimulatorEnvelope } from "@/features/draft/simulator";
import { SIMULATOR_SCENARIOS, SIMULATOR_SCENARIO_LABELS, type SimulatorScenarioId } from "@/features/draft/simulator-scripts";
import { BUTTON_GHOST, BUTTON_PRIMARY, BUTTON_SECONDARY } from "@/features/draft/styles";
import type { DraftStoreState } from "@/features/draft/store";

type PlaybackMode = "velocidad" | "paso_a_paso";
const SPEED_OPTIONS = [0.5, 1, 2, 4] as const;

function scenarioButtonClassName(current: SimulatorScenarioId, target: SimulatorScenarioId): string {
  if (current === target) return BUTTON_PRIMARY;
  return BUTTON_SECONDARY;
}

function modeButtonClassName(current: PlaybackMode, target: PlaybackMode): string {
  if (current === target) return BUTTON_PRIMARY;
  return BUTTON_SECONDARY;
}

interface DraftSetupPanelProps {
  connectionStatus: DraftStoreState["connectionStatus"];
  onStart: (sessionId: string) => void;
  onClose: () => void;
}

// <Dominio><Cosa>: pantalla de configuración previa al draft (TSK-016) -- elegir escenario
// (guiones ya existentes en apps/engine/src/simulator/scripts.json, espejados en
// simulator-scripts.ts) y modo de reproducción, antes de arrancarlo. Reutiliza
// POST /api/session/manual (manual-entry.ts) -- cero endpoint nuevo en el motor.
export function DraftSetupPanel({ connectionStatus, onStart, onClose }: DraftSetupPanelProps) {
  const [scenario, setScenario] = useState<SimulatorScenarioId>("captainsMode");
  const [mode, setMode] = useState<PlaybackMode>("velocidad");
  const [speed, setSpeed] = useState<number>(1);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [envelopes, setEnvelopes] = useState<SimulatorEnvelope[] | null>(null);
  const [cursor, setCursor] = useState(0);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  function selectCaptainsMode() {
    setScenario("captainsMode");
  }
  function selectAllPick() {
    setScenario("allPick");
  }
  function selectSpeedMode() {
    setMode("velocidad");
  }
  function selectStepMode() {
    setMode("paso_a_paso");
  }
  function handleSpeedChange(event: ChangeEvent<HTMLSelectElement>) {
    setSpeed(Number(event.target.value));
  }

  function handleStart() {
    const newSessionId = crypto.randomUUID();
    const script = SIMULATOR_SCENARIOS[scenario];
    const built = buildSimulatorEnvelopes(script);

    cancelledRef.current = false;
    setSessionId(newSessionId);
    setEnvelopes(built);
    setCursor(0);
    setError(null);
    onStart(newSessionId);

    if (mode === "velocidad") {
      setRunning(true);
      // Un fallo de red a mitad de la reproducción (motor caído, desconexión) no debe dejar
      // "Reproduciendo el draft..." colgado para siempre -- mismo hallazgo ya corregido antes en
      // ManualEntryPanel/store.ts (correctHero): sin este catch, la promesa rechazada nunca
      // resuelve `running` a false y el panel queda en un estado que parece congelado.
      runSimulatorPlayback(built, {
        sessionId: newSessionId,
        speed,
        post: postSimulatorEvent,
        isCancelled: () => cancelledRef.current,
      })
        .then(() => setRunning(false))
        .catch(() => {
          setRunning(false);
          setError("Se perdió la conexión con el motor a mitad de la reproducción -- revisa que esté corriendo.");
        });
    }
  }

  async function handleNextEvent() {
    if (!envelopes || !sessionId) return;
    const next = envelopes[cursor];
    if (!next) return;
    setError(null);
    try {
      await postSimulatorEvent(sessionId, next.seq, next.payload);
    } catch {
      setError("No se pudo contactar al motor -- revisa que esté corriendo e inténtalo de nuevo.");
      return;
    }
    setCursor((c) => c + 1);
  }

  function handleClose() {
    cancelledRef.current = true;
    onClose();
  }

  const notReady = connectionStatus !== "conectado";
  const hasStarted = envelopes !== null;
  const total = envelopes?.length ?? 0;
  const stepsLeft = total - cursor;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-surface-border bg-surface-raised p-4">
      <div className="flex items-center justify-between">
        <span className="text-heading text-content-primary">Simular un draft</span>
        <button type="button" onClick={handleClose} className={BUTTON_GHOST}>
          Cerrar
        </button>
      </div>
      <span className="text-caption text-content-muted">
        Ambiente de pruebas: reproduce un guion de draft grabado, sin necesitar Dota 2 abierto. Útil para ver cómo se actualizan
        el tablero y las sugerencias en vivo.
      </span>
      {error && <span className="text-caption text-signal-negative">{error}</span>}

      {!hasStarted && (
        <>
          <div className="flex flex-col gap-1">
            <span className="text-caption text-content-secondary">Escenario</span>
            <div className="flex gap-2">
              <button type="button" onClick={selectCaptainsMode} className={scenarioButtonClassName(scenario, "captainsMode")}>
                {SIMULATOR_SCENARIO_LABELS.captainsMode}
              </button>
              <button type="button" onClick={selectAllPick} className={scenarioButtonClassName(scenario, "allPick")}>
                {SIMULATOR_SCENARIO_LABELS.allPick}
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-caption text-content-secondary">Modo de reproducción</span>
            <div className="flex gap-2">
              <button type="button" onClick={selectSpeedMode} className={modeButtonClassName(mode, "velocidad")}>
                Velocidad
              </button>
              <button type="button" onClick={selectStepMode} className={modeButtonClassName(mode, "paso_a_paso")}>
                Paso a paso
              </button>
            </div>
          </div>

          {mode === "velocidad" && (
            <label className="flex items-center gap-2 text-caption text-content-secondary">
              Velocidad
              <select
                value={speed}
                onChange={handleSpeedChange}
                className="rounded-md border border-surface-border bg-surface-overlay px-2 py-1 text-content-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-primary"
              >
                {SPEED_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}x
                  </option>
                ))}
              </select>
            </label>
          )}

          <button type="button" onClick={handleStart} disabled={notReady} className={BUTTON_PRIMARY}>
            {notReady ? "Conectando..." : "Iniciar"}
          </button>
        </>
      )}

      {hasStarted && mode === "velocidad" && (
        <span className="text-caption text-content-secondary">
          {running ? "Reproduciendo el draft..." : "Draft reproducido por completo."}
        </span>
      )}

      {hasStarted && mode === "paso_a_paso" && (
        <div className="flex items-center gap-3">
          <button type="button" onClick={handleNextEvent} disabled={stepsLeft <= 0 || notReady} className={BUTTON_PRIMARY}>
            {notReady ? "Conectando..." : "Siguiente pick/ban"}
          </button>
          <span className="text-caption text-content-secondary">
            {stepsLeft <= 0 ? "Guion completo." : `${cursor} / ${total}`}
          </span>
        </div>
      )}
    </div>
  );
}
