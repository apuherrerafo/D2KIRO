import type { ReactNode } from "react";
import { HeroIcon } from "@/components/hero-icon/HeroIcon";
import { LOCAL_SIDE_BADGE } from "@/features/draft/styles";
import type { HeroId, TeamSide } from "@/features/draft/types";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";

const TEAM_LABELS: Record<TeamSide, string> = { radiant: "Radiant", dire: "Dire" };
const COMPACT_ICON_SIZE = 32;
const MAX_COMPACT_SLOTS = 5; // MAX_PICKS_PER_SIDE espejado visualmente -- 5 casillas, llenas o vacías

function CompactSlot({ heroId, heroMeta }: { heroId: HeroId | null; heroMeta: HeroMeta | undefined }) {
  if (heroId === null) {
    return <div className="h-8 w-8 flex-none rounded border border-dashed border-surface-border" />;
  }
  if (!heroMeta) {
    return (
      <div
        role="img"
        aria-label={`Héroe ${heroId} (sin datos de catálogo)`}
        className="flex h-8 w-8 flex-none items-center justify-center rounded border border-surface-border bg-surface-overlay text-content-muted text-caption"
      >
        #{heroId}
      </div>
    );
  }
  return <HeroIcon imgUrl={heroMeta.imgUrl} alt={heroMeta.localizedName} size={COMPACT_ICON_SIZE} />;
}

interface CompactSideRowProps {
  side: TeamSide;
  heroIds: HeroId[];
  heroCatalog: Map<number, HeroMeta>;
  isLocal: boolean;
  align: "start" | "end";
}

// 5 casillas siempre, llenas o vacías -- el usuario ve de un vistazo cuántos picks le faltan a
// cada lado sin contar íconos (mismo espíritu que MAX_PICKS_PER_SIDE, TSK-078/079).
function CompactSideRow({ side, heroIds, heroCatalog, isLocal, align }: CompactSideRowProps) {
  const slots: (HeroId | null)[] = Array.from({ length: MAX_COMPACT_SLOTS }, (_, i) => heroIds[i] ?? null);
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${align === "end" ? "items-end" : "items-start"}`}>
      <span className="text-caption text-content-secondary">
        {TEAM_LABELS[side]}
        {isLocal && <span className={LOCAL_SIDE_BADGE}>Tú</span>}
      </span>
      <div className={`flex gap-1 ${align === "end" ? "flex-row-reverse" : ""}`}>
        {slots.map((heroId, index) => (
          <CompactSlot key={heroId ?? `empty-${index}`} heroId={heroId} heroMeta={heroId ? heroCatalog.get(heroId) : undefined} />
        ))}
      </div>
    </div>
  );
}

export interface CompactBoardProps {
  banned: HeroId[];
  picks: { radiant: HeroId[]; dire: HeroId[] };
  localSide: TeamSide | "unknown";
  heroCatalog: Map<number, HeroMeta>;
  // TSK-086: columna central opcional -- por defecto (ausente) es el resumen de bans de siempre,
  // comportamiento idéntico al de antes. `/draft` nunca pasa este prop. `/random-draft` lo usa
  // para mostrar ahí el timer de la ronda en vez de bans (que ya viven, con más detalle, en
  // BanPhasePanel) -- mismo criterio de paridad visual con la pantalla real de All Pick de Dota.
  centerContent?: ReactNode;
}

function DefaultCenterContent({ banned, heroCatalog }: { banned: HeroId[]; heroCatalog: Map<number, HeroMeta> }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-caption text-content-muted">Bans</span>
      <div className="flex max-w-40 flex-wrap justify-center gap-1">
        {banned.length === 0 && <span className="text-caption text-content-muted">—</span>}
        {banned.map((heroId) => (
          <CompactSlot key={heroId} heroId={heroId} heroMeta={heroCatalog.get(heroId)} />
        ))}
      </div>
    </div>
  );
}

// <Dominio><Cosa>: franja superior fija -- resumen de contexto (quién pickeó qué, qué se baneó),
// no el tablero completo. `DraftBoard` sigue existiendo tal cual para donde ya se usa; esto es un
// componente nuevo, más chico, pensado para vivir arriba de la grilla sin competir por altura.
// TSK-085: exportado -- /random-draft lo reusa tal cual para mostrar los picks persistentes de
// rondas anteriores (antes no se veían más después de pasar de ronda, aunque el DraftState real
// sí los conservaba -- era un hueco de renderizado, no de datos).
export function CompactBoard({ banned, picks, localSide, heroCatalog, centerContent }: CompactBoardProps) {
  return (
    <div className="grid flex-none grid-cols-[1fr_auto_1fr] items-start gap-4 border-b border-surface-border bg-surface-raised px-4 py-3">
      <CompactSideRow side="radiant" heroIds={picks.radiant} heroCatalog={heroCatalog} isLocal={localSide === "radiant"} align="start" />
      {centerContent ?? <DefaultCenterContent banned={banned} heroCatalog={heroCatalog} />}
      <CompactSideRow side="dire" heroIds={picks.dire} heroCatalog={heroCatalog} isLocal={localSide === "dire"} align="end" />
    </div>
  );
}

export interface DraftLayoutProps {
  banned: HeroId[];
  picks: { radiant: HeroId[]; dire: HeroId[] };
  localSide: TeamSide | "unknown";
  heroCatalog: Map<number, HeroMeta>;
  // Puramente de presentación -- DraftLayout no conoce pickError/handlers/lógica de negocio,
  // recibe subárboles ya armados por el caller (DraftView.tsx sigue siendo dueño de todo eso).
  topBar?: ReactNode;
  // spec §1.2 (specs/draft-native-experience.md): InputModeSelector -- vive pegado a la grilla,
  // FUERA de su contenedor con scroll (ver abajo) para que no desaparezca al scrollear los 127
  // héroes.
  modeSelector?: ReactNode;
  // spec §2.4: TurnStatusBar -- franja propia entre `topBar` y `CompactBoard`, `flex-none` como
  // el resto de la cabecera (nunca dentro de una región con scroll). El caller (DraftView.tsx)
  // decide si tiene sentido montarla (turn !== null) -- DraftLayout no sabe nada de turnos, solo
  // le da un lugar fijo.
  turnStatusBar?: ReactNode;
  grid: ReactNode;
  suggestionsRail: ReactNode;
}

// <Dominio><Cosa>: RCA post-TSK-076 (auditoría de arquitectura, 2026-08-23) -- reemplaza el
// apilado vertical sin límite de altura de ActiveDraftState por 3 regiones contenidas dentro de
// un viewport fijo. `min-h-0` en la región central es la corrección real del antipatrón: un hijo
// flex sin esa propiedad nunca se encoge por debajo de la altura de su contenido, así que
// `overflow-y-auto` no hacía nada y el scroll terminaba en la página entera.
export function DraftLayout({
  banned,
  picks,
  localSide,
  heroCatalog,
  topBar,
  modeSelector,
  turnStatusBar,
  grid,
  suggestionsRail,
}: DraftLayoutProps) {
  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {topBar && <div className="flex-none px-4 pt-4">{topBar}</div>}
      {turnStatusBar}
      <CompactBoard banned={banned} picks={picks} localSide={localSide} heroCatalog={heroCatalog} />
      <div className="flex min-h-0 flex-1 gap-4 p-4">
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          {modeSelector}
          <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-surface-border bg-surface-raised p-4">{grid}</div>
        </div>
        <div className="flex w-80 min-h-0 flex-none flex-col gap-3 overflow-y-auto">{suggestionsRail}</div>
      </div>
    </div>
  );
}
