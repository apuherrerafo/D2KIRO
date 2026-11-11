// Admitir (o retirar) amigos de la beta privada sin tocar SQLite ni el panel de Railway.
//
//   bun run beta:invite -- <SteamID64 | Steam32 | link steamcommunity.com/profiles/<id>>
//   bun run beta:invite -- --remove <...>
//   bun run beta:invite -- --count
//
// Requisitos: `railway` instalado, sesión iniciada y el proyecto D2KIRO-preview enlazado en esta carpeta
// (`railway link`). Cambia BETA_ALLOWED_STEAM_IDS del servicio, lo que reinicia el sitio ~2-3 min; las cuentas
// y datos viven en el disco persistente y no se pierden. Nunca imprime los Steam32 (dato personal).
import { addToAllowlist, parseAllowlist, parseSteamInput, removeFromAllowlist } from "./allowlist";

const VARIABLE = "BETA_ALLOWED_STEAM_IDS";

function railway(args: string[], stdin?: string): string {
  const result = Bun.spawnSync(["railway", ...args], { stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin), stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`railway ${args[0]} falló: ${result.stderr.toString().split("\n").find((line) => line.trim() && !line.startsWith("warning") && !line.includes("railway.json")) ?? "sin detalle"}`);
  return result.stdout.toString();
}

function readCurrent(): string | undefined {
  const line = railway(["variables", "--kv"]).split(/\r?\n/).find((entry) => entry.startsWith(`${VARIABLE}=`));
  return line?.slice(VARIABLE.length + 1);
}

function main(argv: string[]): number {
  const remove = argv.includes("--remove");
  const countOnly = argv.includes("--count");
  const target = argv.find((arg) => !arg.startsWith("--"));

  const current = readCurrent();
  if (countOnly) {
    console.log(`Cuentas admitidas en la beta: ${parseAllowlist(current).length}`);
    return 0;
  }
  if (target === undefined) {
    console.error("Falta la cuenta. Ejemplo: bun run beta:invite -- 76561198000000001");
    return 2;
  }
  const parsed = parseSteamInput(target);
  if (!parsed.ok) {
    console.error(parsed.reason);
    return 2;
  }

  const change = remove ? removeFromAllowlist(current, parsed.steam32) : addToAllowlist(current, parsed.steam32);
  if (!change.changed) {
    console.log(remove ? "Esa cuenta no estaba en la beta. Sin cambios." : "Esa cuenta ya estaba admitida. Sin cambios.");
    return 0;
  }
  railway(["variable", "set", VARIABLE, "--stdin"], change.next);
  console.log(`${remove ? "Cuenta retirada" : "Cuenta admitida"}. Total en la beta: ${change.count}. El sitio se reinicia solo (2-3 min); después esa persona ya puede entrar con Steam.`);
  return 0;
}

try {
  process.exit(main(process.argv.slice(2)));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Error inesperado");
  process.exit(1);
}
