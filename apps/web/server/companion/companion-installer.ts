import { batchHeader, toCrlf } from "@/lib/gsi-windows-installer";
import { COMPANION_INSTALL_PS, COMPANION_RUNTIME_PS } from "./companion-scripts";

// D2KIRO Companion V0 -- the ONE file the Player runs once. Pure: text in, text out.
//
// Layout (CRLF, cmd.exe + Windows PowerShell 5.1, same bootstrap as lib/gsi-windows-installer):
//   batch preamble -> #D2KIRO-SCRIPT block (the installer) -> #D2KIRO-RUNTIME block (companion.ps1, copied to
//   %LOCALAPPDATA%\D2KIRO\Companion) -> optional #D2KIRO-CFG block (the Player's own link, as the site's cfg).
//
// Two forms:
//   * personal (site download, `cfg` given): carries the link -> deletes itself when it finishes, like the GSI
//     installer, so no extra copy of the credential stays in Downloads.
//   * generic (`cfg` null): carries NO credential -> adopts the D2KIRO cfg already installed in Dota (or the
//     Companion's previous pairing). Safe to keep and re-run; this is what works against the current staging
//     site with zero server changes.

export const COMPANION_INSTALLER_FILENAME = "instalar-d2kiro-companion.cmd";

const RUNTIME_BEGIN = "#D2KIRO-RUNTIME-BEGIN";
const RUNTIME_END = "#D2KIRO-RUNTIME-END";
const CFG_BEGIN = "#D2KIRO-CFG-BEGIN";
const CFG_END = "#D2KIRO-CFG-END";
const MAX_CFG_LENGTH = 4096;

const DESCRIPTION = [
  "D2KIRO Companion - instalador (una sola vez).",
  "Copia el Companion a %LOCALAPPDATA%\\D2KIRO\\Companion, lo hace arrancar con Windows (solo tu usuario, sin administrador)",
  "y deja la conexion de Dota 2 (Game State Integration) apuntando a esta PC. No lee tu cuenta de Steam.",
];

function assertEmbeddableCfg(cfg: string): void {
  const trimmed = cfg.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_CFG_LENGTH || !trimmed.startsWith('"D2KIRO"')) throw new Error("invalid GSI cfg for companion installer");
  if (/[^\x09\x0A\x0D\x20-\x7E]/.test(trimmed) || trimmed.includes("#D2KIRO-")) throw new Error("invalid GSI cfg for companion installer");
}

export function buildWindowsCompanionInstaller(cfg: string | null): string {
  if (cfg !== null) assertEmbeddableCfg(cfg);
  const lines = [...batchHeader("install", "D2KIRO Companion - instalacion", cfg === null ? DESCRIPTION : [...DESCRIPTION, "Contiene tu conexion personal con D2KIRO: no lo compartas. Se borra solo al terminar."])];
  lines.push('set "D2KIRO_EXIT=%ERRORLEVEL%"');
  // Personal: `(goto)` ends the batch first so the file can delete itself. Nothing below is batch code.
  lines.push(cfg === null ? "exit /b %D2KIRO_EXIT%" : '(goto) 2>nul & del "%~f0" & exit /b %D2KIRO_EXIT%');
  lines.push(COMPANION_INSTALL_PS, RUNTIME_BEGIN, COMPANION_RUNTIME_PS, RUNTIME_END);
  if (cfg !== null) lines.push(CFG_BEGIN, cfg.trim(), CFG_END);
  return toCrlf(lines);
}
