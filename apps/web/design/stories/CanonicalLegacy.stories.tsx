/* VRT · StateTarget y HeroDraftSlot SIN las props nuevas (Fase 3D.2). Estos baselines se generaron con el DS ORIGINAL (antes de `pressed` / `showPlate`)
   y deben seguir pasando con el DS extendido: es la prueba de que los consumidores anteriores conservan su apariencia. No usar las props nuevas aquí. */
import { StateTarget, TARGET_STATES } from "@/design/canonical/primitives";
import { HeroDraftSlot } from "@/design/canonical/hero-media";
import { LightGrid } from "./_canonicalScope";

const meta = { title: "DS V1 / Canonical VRT / Legacy (sin props nuevas)", parameters: { layout: "fullscreen" } };
export default meta;

const noop = () => undefined;
const SLOT_STATES = ["available", "selected", "recommended", "confirmed", "banned", "unknown"] as const;

export function StateTargetAllStates() {
  return (
    <LightGrid>
      {TARGET_STATES.map((state) => <StateTarget key={state} notch="Recomendado" state={state} title={`Pos3 · ${state}`} value="Centaur Warrunner" />)}
    </LightGrid>
  );
}

export function StateTargetInteractiveAllStates() {
  return (
    <LightGrid>
      {TARGET_STATES.map((state) => <StateTarget key={state} notch="Recomendado" onPress={noop} state={state} title={`btn · ${state}`} value="Tusk" />)}
    </LightGrid>
  );
}

export function HeroDraftSlotAllStates() {
  return (
    <LightGrid columns={6} width={150}>
      {SLOT_STATES.map((state) => <HeroDraftSlot hero="Tusk" key={state} position={4} size="sm" state={state} />)}
    </LightGrid>
  );
}

export function HeroDraftSlotInteractiveAndForced() {
  return (
    <LightGrid columns={6} width={150}>
      {SLOT_STATES.map((state) => <HeroDraftSlot hero="Luna" key={state} onClick={noop} showRole={false} size="sm" state={state} />)}
      <HeroDraftSlot hero="Luna" preview="hover" size="sm" state="available" />
      <HeroDraftSlot hero="Luna" preview="focus" size="sm" state="available" />
    </LightGrid>
  );
}
