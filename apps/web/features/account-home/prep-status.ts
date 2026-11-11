// Estado de preparación del jugador, derivado de lo que el motor ya sabe. Funciones puras: el texto que se muestra sale
// de aquí y se prueba aquí. Ningún estado es silencioso: cargando, error, vacío y listo dicen cada uno lo que pasa.

export type PrepKind = "loading" | "error" | "empty" | "ready" | "stale";

export interface PrepStatus {
  kind: PrepKind;
  text: string;
}

export interface MetaStatusLike {
  syncedAt: string | null;
  isStale: boolean;
}

const ANONYMOUS = "Jugador de Steam";

export function greetingFor(personaName: string | null): string {
  if (personaName === null) return "Hola";
  const name = personaName.trim();
  if (name === "" || name === ANONYMOUS) return "Hola";
  return `Hola, ${name}`;
}

export function describePool(isLoading: boolean, failed: boolean, count: number, max: number): PrepStatus {
  if (isLoading) return { kind: "loading", text: "Leyendo tu pool…" };
  if (failed) return { kind: "error", text: "No pudimos leer tu pool ahora. Puedes entrar igual y reintentar desde su pantalla." };
  if (count === 0) return { kind: "empty", text: "Todavía no elegiste tus héroes. Con tu pool, el coach prioriza los que dominas." };
  return { kind: "ready", text: `${count} de ${max} héroes en tu pool.` };
}

export function describeTeams(isLoading: boolean, failed: boolean, count: number): PrepStatus {
  if (isLoading) return { kind: "loading", text: "Leyendo tus equipos…" };
  if (failed) return { kind: "error", text: "No pudimos leer tus equipos ahora." };
  if (count === 0) return { kind: "empty", text: "Sin equipos guardados. Solo los necesitas para jugar en party." };
  if (count === 1) return { kind: "ready", text: "1 equipo guardado." };
  return { kind: "ready", text: `${count} equipos guardados.` };
}

export function describeMeta(isLoading: boolean, failed: boolean, status: MetaStatusLike | null): PrepStatus {
  if (isLoading) return { kind: "loading", text: "Leyendo el estado del meta…" };
  if (failed || status === null) return { kind: "error", text: "No pudimos leer el estado del meta ahora." };
  if (status.syncedAt === null) return { kind: "empty", text: "El meta del parche todavía no se sincronizó." };
  if (status.isStale) return { kind: "stale", text: "Los datos del parche tienen más de 24 horas. El coach lo marca en sus consejos." };
  return { kind: "ready", text: "Los datos del parche están al día." };
}
