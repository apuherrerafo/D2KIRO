"use client";

import { useEffect, useState } from "react";
import { BUTTON_PRIMARY } from "@/features/draft/styles";

interface Account {
  steamAccountId: number;
  personalBaselineWinrate?: number | null;
}

export default function SettingsPage() {
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/engine/api/account", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<Account> : Promise.reject())
      .then(setAccount)
      .catch(() => setError(true));
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.assign("/login");
  }

  return <main className="flex min-h-screen flex-col gap-4 bg-surface-base p-6">
    <h1 className="text-heading text-content-primary">Mi cuenta</h1>
    {error && <span className="text-body text-signal-negative">No se pudo cargar tu cuenta.</span>}
    {!account && !error && <span className="text-body text-content-secondary">Cargando...</span>}
    {account && <div className="rounded-lg border border-surface-border bg-surface-raised p-4 text-body text-content-primary">
      <p>Steam32: {account.steamAccountId}</p>
      {account.personalBaselineWinrate !== null && account.personalBaselineWinrate !== undefined && <p>Winrate base: {(account.personalBaselineWinrate * 100).toFixed(0)}%</p>}
    </div>}
    <button type="button" onClick={logout} className={BUTTON_PRIMARY}>Cerrar sesión</button>
  </main>;
}
