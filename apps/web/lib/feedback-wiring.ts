import { getCanonicalOrigin } from "./canonical-origin";
import { createFeedbackAdminHandlers } from "./feedback-admin-handler";
import { createFeedbackHandlers } from "./feedback-handler";
import { createObjectStorage, readObjectStorageConfig, type ObjectStorage } from "./object-storage";
import { isSessionStillAllowed } from "./beta-access";
import { getSession, renewSessionIfNeeded, displayPersonaName } from "./session";

// Cableado de las rutas de feedback con el entorno real. Las rutas son delgadas; la lógica (y sus pruebas) vive en feedback-handler.ts.

function storage(): ObjectStorage | null {
  const config = readObjectStorageConfig(process.env);
  return config === null ? null : createObjectStorage(config);
}

async function validSession(): Promise<{ accountId: number; personaName: string } | null> {
  const session = await getSession();
  if (!(await renewSessionIfNeeded(session))) return null;
  if (!isSessionStillAllowed(session.accountId)) return null;
  return { accountId: session.accountId, personaName: displayPersonaName(session.personaName) };
}

export function feedbackHandlers() {
  return createFeedbackHandlers({ session: validSession, env: process.env, publicOrigin: getCanonicalOrigin(), now: Date.now, storage: storage() });
}

export function feedbackAdminHandlers() {
  return createFeedbackAdminHandlers({
    accountId: async () => (await validSession())?.accountId ?? null,
    env: process.env,
    publicOrigin: getCanonicalOrigin(),
    now: Date.now,
  });
}
