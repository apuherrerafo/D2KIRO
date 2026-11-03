import { useId, type CSSProperties, type Ref } from "react";
import {
  ContradictionMarker,
  EvidenceDefs,
  EvidenceLabelTag,
  EvidenceNode,
  EvidencePath,
  HeroEcho,
  MatchupSliver,
  OriginSeal,
  RoleMarker,
  UnresolvedRegion,
  labelAnchor,
} from "./primitives";
import { MEMORY_SCENES } from "./fake-scenario-memory";
import { MEMORY_VIEWBOX, type EvidenceItem, type MemoryScene, type MemorySceneId } from "./types";
import "./memory-strip.css";

/* Layers, bottom → top. The SVG draws structure (region, paths, matchup, markers); the DOM draws hero art
   and words. Every item renders under its stable `data-evidence` id, so a later motion pass can transform
   the same evidence between scenes instead of replacing it. */
const SVG_KINDS: readonly EvidenceItem["kind"][] = ["region", "path", "matchup", "node", "contradiction", "role"];
const PATH_ORDER = { undertrace: 0, uncertain: 1, retained: 2, qualified: 3 } as const;

export function SvgItem({ item, patternId }: { item: EvidenceItem; patternId: string }) {
  switch (item.kind) {
    case "region": return <UnresolvedRegion item={item} />;
    case "path": return <EvidencePath item={item} />;
    case "matchup": return <MatchupSliver item={item} patternId={patternId} />;
    case "node": return <EvidenceNode item={item} />;
    case "contradiction": return <ContradictionMarker item={item} />;
    case "role": return <RoleMarker item={item} />;
    default: return null;
  }
}

export function DomItem({ item }: { item: EvidenceItem }) {
  if (item.kind === "origin") return <OriginSeal item={item} />;
  if (item.kind === "echo") return <HeroEcho item={item} />;
  return null;
}

export function sortForPaint(items: readonly EvidenceItem[]): EvidenceItem[] {
  const rank = (item: EvidenceItem) => SVG_KINDS.indexOf(item.kind) * 10 + (item.kind === "path" ? PATH_ORDER[item.relation] : 0);
  return items.filter((item) => SVG_KINDS.includes(item.kind)).sort((a, b) => rank(a) - rank(b));
}

export function ActiveAnnotation({ scene, innerRef }: { scene: MemoryScene; innerRef?: Ref<HTMLDivElement> }) {
  return (
    <div className="ms-annotation" ref={innerRef}>
      <p className="ms-stage" data-numbered={scene.stage.number ? "true" : "false"}>
        <span className="ms-stage-kicker">{scene.stage.kicker}</span>
        {scene.stage.number && <span className="ms-stage-number">{scene.stage.number}</span>}
      </p>
      <p className="ms-copy">{scene.annotation}</p>
      <p className="ms-note">{scene.evidenceNote}</p>
    </div>
  );
}

function EvidenceDescription({ scene, id }: { scene: MemoryScene; id: string }) {
  return (
    <figcaption id={id} className="ms-sr">
      <span>{`${scene.stage.kicker} ${scene.stage.number ?? ""}`.trim()}. {scene.hero.name}, {scene.role}. {scene.draftContext}.</span>
      <ul>
        {scene.items.map((item) => <li key={item.id} data-evidence-text={item.id}>{item.meaning}</li>)}
      </ul>
    </figcaption>
  );
}

export interface EvidenceViewProps {
  /** The scene this view is about (target scene during a transition): description, data-scene, default items and labels. */
  scene: MemoryScene;
  /** Evidence to draw. Defaults to the scene's own; the motion player adds the earlier scene's folding evidence as ghosts. */
  items?: readonly EvidenceItem[];
  /** Earlier-scene evidence whose label is still leaving. Rendered under `ghost:<id>` so it never collides with a live label. */
  ghostLabelItems?: readonly EvidenceItem[];
  annotationScene?: MemoryScene;
  motion?: boolean;
  canvasRef?: Ref<HTMLDivElement>;
  annotationRef?: Ref<HTMLDivElement>;
}

export function EvidenceView({ scene, items = scene.items, ghostLabelItems = [], annotationScene = scene, motion = false, canvasRef, annotationRef }: EvidenceViewProps) {
  const uid = useId().replace(/:/g, "");
  const patternId = `ms-hatch-${uid}`;
  const descId = `ms-desc-${uid}`;
  return (
    <div className="ms-host">
    <section className="ms" data-testid="memory-strip" data-scene={scene.id} data-motion={motion ? "on" : undefined} aria-label="Memory Strip">
      <div className="ms-layout">
        <figure className="ms-object" aria-describedby={descId}>
          <div className="ms-canvas" ref={canvasRef} style={{ "--ms-ar": `${MEMORY_VIEWBOX.w} / ${MEMORY_VIEWBOX.h}` } as CSSProperties}>
            <svg className="ms-svg" viewBox={`0 0 ${MEMORY_VIEWBOX.w} ${MEMORY_VIEWBOX.h}`} aria-hidden="true" focusable="false">
              <EvidenceDefs patternId={patternId} />
              {sortForPaint(items).map((item) => <SvgItem key={item.id} item={item} patternId={patternId} />)}
            </svg>
            <div className="ms-dom" aria-hidden="true">
              {items.map((item) => <DomItem key={item.id} item={item} />)}
              {scene.items.map((item) => {
                const anchor = labelAnchor(item);
                if (!item.label || !anchor) return null;
                return <EvidenceLabelTag key={item.id} itemId={item.id} label={item.label} anchor={anchor} active={Boolean(item.active)} />;
              })}
              {ghostLabelItems.map((item) => {
                const anchor = labelAnchor(item);
                if (!item.label || !anchor) return null;
                return <EvidenceLabelTag key={`ghost:${item.id}`} itemId={`ghost:${item.id}`} label={item.label} anchor={anchor} active={Boolean(item.active)} />;
              })}
            </div>
          </div>
          <EvidenceDescription scene={scene} id={descId} />
        </figure>
        <ActiveAnnotation scene={annotationScene} innerRef={annotationRef} />
      </div>
    </section>
    </div>
  );
}

export function MemoryStripScene({ sceneId }: { sceneId: MemorySceneId }) {
  return <EvidenceView scene={MEMORY_SCENES[sceneId]} />;
}
