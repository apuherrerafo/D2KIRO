"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { useGetSettingsQuery, useUpdateSettingMutation } from "@/lib/engine-api";
import { BUTTON_PRIMARY } from "@/features/draft/styles";

interface SettingRowProps {
  settingKey: string;
  value: string;
}

function SettingRow({ settingKey, value }: SettingRowProps) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-surface-border bg-surface-raised p-3">
      <span className="text-body text-content-primary">{settingKey}</span>
      <span className="text-caption text-content-secondary">{value}</span>
    </div>
  );
}

// Página normal del sitio: RTK Query contra GET/PUT /api/settings -- preferencias locales de
// fase 1, sin autenticación (regla dura del ticket: no se implementa auth, solo se evita
// bloquear la puerta para cuando exista, vía la estructura de rutas normal de apps/web).
export default function SettingsPage() {
  const { data, isLoading, error } = useGetSettingsQuery();
  const [updateSetting, { isLoading: isSaving }] = useUpdateSettingMutation();
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");

  function handleKeyChange(event: ChangeEvent<HTMLInputElement>) {
    setKey(event.target.value);
  }

  function handleValueChange(event: ChangeEvent<HTMLInputElement>) {
    setValue(event.target.value);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (key.length === 0) return;
    await updateSetting({ key, value });
    setKey("");
    setValue("");
  }

  return (
    <main className="flex min-h-screen flex-col gap-4 bg-surface-base p-6">
      <span className="text-heading text-content-primary">Configuración</span>

      {isLoading && <span className="text-body text-content-secondary">Cargando...</span>}
      {error && <span className="text-body text-signal-negative">No se pudo cargar la configuración.</span>}
      {data && (
        <div className="flex flex-col gap-2">
          {data.map((setting) => (
            <SettingRow key={setting.key} settingKey={setting.key} value={setting.value} />
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-2 rounded-lg border border-surface-border bg-surface-raised p-4">
        <span className="text-body text-content-primary">Nueva preferencia</span>
        <input
          type="text"
          value={key}
          onChange={handleKeyChange}
          placeholder="Clave"
          className="rounded-md border border-surface-border bg-surface-overlay px-3 py-2 text-body text-content-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-primary"
        />
        <input
          type="text"
          value={value}
          onChange={handleValueChange}
          placeholder="Valor"
          className="rounded-md border border-surface-border bg-surface-overlay px-3 py-2 text-body text-content-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-primary"
        />
        <button type="submit" disabled={isSaving} className={BUTTON_PRIMARY}>
          Guardar
        </button>
      </form>
    </main>
  );
}
