"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AccountAvatar } from "@/components/app-shell/AccountAvatar";
import { AppLink } from "@/components/app-shell/AppLink";
import { AppNotice } from "@/components/app-shell/AppNotice";
import { PageHead } from "@/components/app-shell/PageHead";
import { refreshAccountProfile, useAccountProfile, type AccountProfile } from "@/lib/use-account-profile";

interface AccountSettings {
  personalBaselineWinrate?: number | null;
}

type SettingsState = { kind: "loading" } | { kind: "ready"; settings: AccountSettings } | { kind: "error" };

export function formatBaselineWinrate(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return `${(value * 100).toFixed(0)}%`;
}

function useAccountSettings(): SettingsState {
  const [state, setState] = useState<SettingsState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch("/engine/api/account", { cache: "no-store" })
      .then(async (response) => (response.ok ? ((await response.json()) as AccountSettings) : Promise.reject(new Error("account_unavailable"))))
      .then((settings) => {
        if (!cancelled) setState({ kind: "ready", settings });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

function ProfileRow({ profile }: { profile: AccountProfile }) {
  return (
    <div className="ap-row-main">
      <AccountAvatar avatarUrl={profile.avatarUrl} />
      <div className="ap-row-text">
        <span className="ap-row-name" data-testid="account-name">{profile.personaName}</span>
        <span className="ap-row-meta" data-testid="steam-connected">Steam conectado</span>
      </div>
    </div>
  );
}

function retryLabel(busy: boolean): string {
  if (busy) return "Leyendo tu perfil…";
  return "Reintentar";
}

function RetryFailedHint({ show }: { show: boolean }) {
  if (!show) return null;
  return <p className="ap-hint" data-testid="profile-retry-failed">Steam no respondió con tu perfil esta vez. Revisa que tu perfil de Steam sea público y vuelve a intentar.</p>;
}

// Autenticación y perfil son cosas distintas: aquí Steam YA confirmó quién eres (hay sesión); lo que falta es leer tu nombre y avatar públicos.
// Se reintenta solo una vez al abrir la pantalla; después, con el botón. Nunca se muestra como error de acceso.
function ProfileUnavailableNotice({ profile }: { profile: AccountProfile }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const triedAutomatically = useRef(false);

  const retry = useCallback(async () => {
    setBusy(true);
    setFailed(!(await refreshAccountProfile()));
    setBusy(false);
  }, []);

  useEffect(() => {
    if (profile.profileStatus !== "unavailable" || triedAutomatically.current) return;
    triedAutomatically.current = true;
    void retry();
  }, [profile.profileStatus, retry]);

  function handleRetry() {
    void retry();
  }

  if (profile.profileStatus !== "unavailable") return null;
  return (
    <AppNotice tone="warning" title="Steam confirmó tu cuenta, pero no pudimos leer tu perfil público" testId="profile-unavailable">
      <p>Tu sesión está bien abierta. Mostramos «{profile.personaName}» hasta poder leer tu nombre y avatar de Steam.</p>
      <RetryFailedHint show={failed} />
      <div className="ap-notice-actions">
        <button type="button" className="ap-btn" onClick={handleRetry} disabled={busy} data-testid="profile-retry">
          {retryLabel(busy)}
        </button>
      </div>
    </AppNotice>
  );
}

function ProfileSection({ state }: { state: ReturnType<typeof useAccountProfile> }) {
  if (state.kind === "loading") return <p className="ap-loading" role="status">Cargando tu cuenta…</p>;
  if (state.kind === "unavailable") {
    return (
      <AppNotice tone="warning" title="No pudimos leer tu perfil de Steam">
        <p>Tu sesión sigue abierta. Vuelve a cargar la página en un momento.</p>
      </AppNotice>
    );
  }
  return (
    <>
      <div className="ap-row">
        <ProfileRow profile={state.profile} />
      </div>
      <ProfileUnavailableNotice profile={state.profile} />
    </>
  );
}

function AdminShortcut({ state }: { state: ReturnType<typeof useAccountProfile> }) {
  if (state.kind !== "ready" || !state.profile.isAdmin) return null;
  return <AppLink href="/admin/invitaciones" testId="account-invite-friends">Invitar amigos</AppLink>;
}

function BaselineSection({ state }: { state: SettingsState }) {
  if (state.kind === "loading") return null;
  if (state.kind === "error") {
    return (
      <AppNotice tone="error" title="No se pudo cargar tu configuración">
        <p>Tu cuenta sigue funcionando. Vuelve a abrir esta pantalla para reintentar.</p>
      </AppNotice>
    );
  }
  const baseline = formatBaselineWinrate(state.settings.personalBaselineWinrate);
  if (baseline === null) {
    return <p className="ap-hint">Todavía no hay un winrate base guardado para tu cuenta.</p>;
  }
  return (
    <div className="ap-row">
      <div className="ap-row-text">
        <span className="ap-row-name" data-testid="account-baseline">Winrate base: {baseline}</span>
        <span className="ap-row-meta">Es la referencia personal con la que el coach compara tus héroes.</span>
      </div>
    </div>
  );
}

// <Dominio><Cosa>: "Mi cuenta". Muestra a la persona por su nombre y avatar de Steam, nunca por su identificador, y
// deja salir de la sesión. Los atajos llevan a lo que el jugador viene a ajustar.
export function AccountPage() {
  const profile = useAccountProfile(true);
  const settings = useAccountSettings();

  return (
    <main className="ap-main" data-testid="account-page">
      <PageHead kicker="Cuenta" title="Mi cuenta" lede="Tu pool de héroes y tus equipos pertenecen a esta cuenta; nadie más los ve ni los usa." />
      <section className="ap-block" aria-labelledby="account-profile-title">
        <h2 className="ap-h2" id="account-profile-title">Perfil</h2>
        <ProfileSection state={profile} />
        <BaselineSection state={settings} />
      </section>
      <section className="ap-block" aria-labelledby="account-shortcuts-title">
        <h2 className="ap-h2" id="account-shortcuts-title">Lo que puedes ajustar</h2>
        <div className="ap-actions">
          <AppLink href="/hero-pool">Mi pool de héroes</AppLink>
          <AppLink href="/team-groups">Mis equipos</AppLink>
          <AppLink href="/live-draft">Conectar Dota 2</AppLink>
          <AdminShortcut state={profile} />
        </div>
      </section>
      <section className="ap-block" aria-labelledby="account-session-title">
        <h2 className="ap-h2" id="account-session-title">Sesión</h2>
        <form action="/api/auth/logout" method="post" className="ap-actions">
          <button type="submit" className="ap-btn ap-btn--solid" data-testid="account-logout">Cerrar sesión</button>
        </form>
      </section>
    </main>
  );
}
