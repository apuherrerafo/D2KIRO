/* VRT · props nuevas aprobadas (Fase 3D.2): `StateTarget.pressed` y `HeroDraftSlot.showPlate`, con sus valores por defecto y la tarjeta real
   «recomendado + abierto en análisis». Componentes canónicos reales en tema Light. */
import { StateTarget } from "@/design/canonical/primitives";
import { HeroDraftSlot } from "@/design/canonical/hero-media";
import { LightGrid } from "./_canonicalScope";

const meta = { title: "DS V1 / Canonical VRT / Extensiones 3D.2", parameters: { layout: "fullscreen" } };
export default meta;

const noop = () => undefined;

export function StateTargetPressed() {
  return (
    <LightGrid>
      <StateTarget notch="ELIGE AHORA" onPress={noop} state="rest" title="rest · sin pressed" value="Tusk" />
      <StateTarget notch="ELIGE AHORA" onPress={noop} pressed state="rest" title="rest + pressed" value="Tusk" />
      <StateTarget notch="ELIGE AHORA" onPress={noop} state="recommended" title="recommended" value="Centaur Warrunner" />
      <StateTarget notch="ELIGE AHORA" onPress={noop} pressed state="recommended" title="recommended + pressed" value="Centaur Warrunner" />
      <StateTarget notch="ELIGE AHORA" onPress={noop} pressed={false} state="recommended" title="recommended + pressed=false" value="Centaur Warrunner" />
      <StateTarget notch="ELIGE AHORA" onPress={noop} pressed state="uncertain" title="uncertain + pressed" value="Skywrath Mage" />
      <StateTarget notch="ELIGE AHORA" onPress={noop} state="selected" title="selected (legacy)" value="Tusk" />
      <StateTarget notch="ELIGE AHORA" onPress={noop} pressed={false} state="selected" title="selected + pressed=false" value="Tusk" />
      <StateTarget notch="ELIGE AHORA" onPress={noop} pressed state="focus" title="focus + pressed" value="Tusk" />
      <StateTarget notch="ELIGE AHORA" onPress={noop} pressed state="hover" title="hover + pressed" value="Tusk" />
      <StateTarget notch="ELIGE AHORA" pressed state="recommended" title="div + pressed (sin efecto)" value="Centaur Warrunner" />
      <StateTarget notch="ELIGE AHORA" onPress={noop} pressed state="disabled" title="disabled + pressed" value="Tusk" />
    </LightGrid>
  );
}

const STATES = ["available", "selected", "recommended", "confirmed", "banned", "unknown"] as const;

export function HeroDraftSlotShowPlate() {
  return (
    <LightGrid columns={6} width={150}>
      {STATES.map((state) => <HeroDraftSlot hero="Tusk" key={`d${state}`} position={4} size="sm" state={state} />)}
      {STATES.map((state) => <HeroDraftSlot hero="Tusk" key={`t${state}`} position={4} showPlate size="sm" state={state} />)}
      {STATES.map((state) => <HeroDraftSlot hero="Tusk" key={`f${state}`} position={4} showPlate={false} size="sm" state={state} />)}
    </LightGrid>
  );
}

/** Dos celdas que DEBEN ser idénticas: sin la prop y con `showPlate` explícito (valor por defecto). */
export function ShowPlateDefaultPair() {
  return (
    <LightGrid columns={2} width={150}>
      <div data-cell="default"><HeroDraftSlot hero="Luna" showRole={false} showStateBadge={false} size="sm" state="available" /></div>
      <div data-cell="explicit"><HeroDraftSlot hero="Luna" showPlate showRole={false} showStateBadge={false} size="sm" state="available" /></div>
    </LightGrid>
  );
}

/** La tarjeta real de la Fase 3D.2: StateTarget (onPress + pressed) + HeroDraftSlot sin placa. */
function Card({ pressed, recommended }: { pressed: boolean; recommended: boolean }) {
  return (
    <StateTarget notch="ELIGE AHORA" onPress={noop} pressed={pressed} state={recommended ? "recommended" : "rest"} title="#1 en el ranking · Pos3 Offlane" value="Centaur Warrunner">
      <span style={{ alignItems: "center", display: "grid", gap: 12, gridTemplateColumns: "128px 1fr", marginTop: 8 }}>
        <span style={{ display: "block", paddingBottom: 8 }}>
          <HeroDraftSlot alt="" hero="Centaur Warrunner" showPlate={false} showRole={false} showStateBadge={false} size="fill" state="available" />
        </span>
        <span style={{ font: "600 12px/1.2 var(--f-plex)" }}>{pressed ? "En análisis" : "Plan de equipo"}</span>
      </span>
    </StateTarget>
  );
}

export function ComposedCard() {
  return (
    <LightGrid columns={2} width={300}>
      <Card pressed={false} recommended />
      <Card pressed recommended />
      <Card pressed={false} recommended={false} />
      <Card pressed recommended={false} />
    </LightGrid>
  );
}
