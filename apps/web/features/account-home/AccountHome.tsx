"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppLink } from "@/components/app-shell/AppLink";
import { ActionPrimary } from "@/design/canonical/primitives/ActionPrimary";
import { Glass } from "@/design/canonical/primitives/Glass";
import { useGetHeroPoolQuery, useGetMetaStatusQuery, useGetTeamGroupsQuery } from "@/lib/engine-api";
import { useAccountProfile } from "@/lib/use-account-profile";
import { MAX_POOL_SIZE } from "@/features/hero-pool/constants";
import { describeMeta, describePool, describeTeams, greetingFor, type PrepStatus } from "./prep-status";

interface PrepItemProps {
  name: string;
  status: PrepStatus;
  href: string;
  actionLabel: string;
  testId: string;
}

function PrepItem({ name, status, href, actionLabel, testId }: PrepItemProps) {
  return (
    <li className="ap-prep-item" data-testid={testId} data-prep-state={status.kind}>
      <h3 className="ap-prep-name">{name}</h3>
      <p className="ap-prep-state">{status.text}</p>
      <AppLink href={href} look="outline">
        {actionLabel}
      </AppLink>
    </li>
  );
}

interface ChoiceCardProps {
  href: string;
  title: string;
  body: string;
  testId: string;
}

function ChoiceCard({ href, title, body, testId }: ChoiceCardProps) {
  return (
    <Glass>
      <Link href={href} className="ap-choice" data-testid={testId}>
        <h3 className="ap-choice-title">{title}</h3>
        <p className="ap-choice-body">{body}</p>
      </Link>
    </Glass>
  );
}

function usePreparation() {
  const pool = useGetHeroPoolQuery();
  const teams = useGetTeamGroupsQuery();
  const meta = useGetMetaStatusQuery();
  return {
    pool: describePool(pool.isLoading, pool.error !== undefined, pool.data?.length ?? 0, MAX_POOL_SIZE),
    teams: describeTeams(teams.isLoading, teams.error !== undefined, teams.data?.length ?? 0),
    meta: describeMeta(meta.isLoading, meta.error !== undefined, meta.data ?? null),
  };
}

function poolActionLabel(status: PrepStatus): string {
  if (status.kind === "ready") return "Editar mi pool";
  return "Configurar mi pool";
}

function teamsActionLabel(status: PrepStatus): string {
  if (status.kind === "ready") return "Ver mis equipos";
  return "Armar un equipo";
}

// <Dominio><Cosa>: la pantalla de inicio del jugador con sesión. Dice qué puede hacer ahora (practicar, preparar el
// draft en vivo) y qué le falta preparar (pool, equipos, meta), leyendo el estado real: nada de esto es decoración.
export function AccountHome() {
  const router = useRouter();
  const profile = useAccountProfile(true);
  const prep = usePreparation();
  const greeting = greetingFor(profile.kind === "ready" ? profile.profile.personaName : null);

  function handleOpenSimulator() {
    router.push("/simulator");
  }

  return (
    <main className="ap-main ap-main--wide" data-testid="account-home">
      <Glass className="ap-hero-card" surfaceLevel="3">
        <header className="ap-head">
          <p className="ap-kicker">Coach de draft para Dota 2</p>
          <h1 className="ap-title">{greeting}</h1>
          <p className="ap-lede">
            D2KIRO lee los bans y los picks de tu draft, mira tu pool de héroes y te muestra qué elegir en tu turno, con el
            porqué al lado. Si la evidencia es poca, te lo dice.
          </p>
        </header>
        <div className="ap-actions">
          <ActionPrimary onPress={handleOpenSimulator} testId="home-open-simulator">
            Abrir el Simulador
          </ActionPrimary>
          <AppLink href="/live-draft" testId="home-open-live">
            Preparar Draft en vivo
          </AppLink>
        </div>
      </Glass>

      <section className="ap-grid ap-grid--2" aria-label="Dónde jugar">
        <ChoiceCard
          href="/simulator"
          testId="home-choice-simulator"
          title="Simulador"
          body="Practica un draft completo contra un rival simulado. Juegas Solo, Party 2, Party 3 o Party 5 y ves el consejo en cada turno."
        />
        <ChoiceCard
          href="/live-draft"
          testId="home-choice-live"
          title="Draft en vivo"
          body="Conecta Dota 2 una vez y el coach sigue tu draft real, turno a turno, para Solo o Party 5."
        />
      </section>

      <section className="ap-block" aria-labelledby="home-prep-title">
        <h2 className="ap-h2" id="home-prep-title">
          Antes de tu próximo draft
        </h2>
        <ul className="ap-prep">
          <PrepItem name="Mi pool de héroes" status={prep.pool} href="/hero-pool" actionLabel={poolActionLabel(prep.pool)} testId="home-prep-pool" />
          <PrepItem name="Equipos guardados" status={prep.teams} href="/team-groups" actionLabel={teamsActionLabel(prep.teams)} testId="home-prep-teams" />
          <PrepItem name="Meta del parche" status={prep.meta} href="/meta" actionLabel="Ver el meta" testId="home-prep-meta" />
        </ul>
      </section>
    </main>
  );
}
