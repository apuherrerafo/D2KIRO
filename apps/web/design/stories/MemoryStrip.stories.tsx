/* DS V1 · Landing 01B · Memory Strip — Phases A and B: five deterministic static states, desktop and mobile. No scroll, no motion. */
import type { CSSProperties } from "react";
import "@/design/round-3a-labs.css";
import "@/design/round-3b-labs.css";
import "@/design/canonical/tokens.css";
import "@/design/canonical/primitives/primitives.css";
import "@/design/canonical/canonical.css";
import { MEMORY_SCENE_ORDER, MemoryStripScene } from "@/features/landing/memory-strip";
import type { MemorySceneId } from "@/features/landing/memory-strip";

const SCENES: readonly MemorySceneId[] = MEMORY_SCENE_ORDER;

const meta = {
  title: "DS V1 / Landing 01B / Memory Strip",
  component: MemoryStripScene,
  args: { sceneId: "match-24" satisfies MemorySceneId },
  argTypes: { sceneId: { control: "select", options: [...SCENES] } },
  parameters: { layout: "fullscreen" },
};
export default meta;

function Frame({ sceneId, width }: { sceneId: MemorySceneId; width?: number }) {
  const style: CSSProperties = width ? { margin: "0 auto", width } : {};
  return (
    <div className="r3-page" data-theme="dark" style={style}>
      <MemoryStripScene sceneId={sceneId} />
    </div>
  );
}

export function Match01() { return <Frame sceneId="match-01" />; }
export function Match08() { return <Frame sceneId="match-08" />; }
export function Match24() { return <Frame sceneId="match-24" />; }
export function Match56() { return <Frame sceneId="match-56" />; }
export function PlayerModel() { return <Frame sceneId="player-model" />; }
export function Match01Mobile() { return <Frame sceneId="match-01" width={390} />; }
export function Match08Mobile() { return <Frame sceneId="match-08" width={390} />; }
export function Match24Mobile() { return <Frame sceneId="match-24" width={390} />; }
export function Match56Mobile() { return <Frame sceneId="match-56" width={390} />; }
export function PlayerModelMobile() { return <Frame sceneId="player-model" width={390} />; }

/** Review control: pick any of the five scenes from the Controls panel. */
export function Review({ sceneId = "match-24" }: { sceneId?: MemorySceneId }) { return <Frame sceneId={sceneId} />; }
