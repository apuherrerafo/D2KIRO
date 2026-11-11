"use client";

import { ActionPrimary } from "@/design/canonical/primitives/ActionPrimary";

export const STEAM_LOGIN_PATH = "/api/auth/steam/login";

// El único compromiso de la pantalla de acceso: ir a Steam. Es una navegación completa (Steam responde con una
// redirección firmada), no una llamada de API, así que se hace con `location.assign`.
export function LoginAction() {
  function handleLogin() {
    window.location.assign(STEAM_LOGIN_PATH);
  }

  return (
    <ActionPrimary onPress={handleLogin} testId="login-steam">
      Entrar con Steam
    </ActionPrimary>
  );
}
