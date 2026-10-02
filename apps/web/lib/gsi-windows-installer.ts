// Zero-terminal Windows installer for the D2KIRO GSI cfg. Pure: text in, text out.
//
// Why a .cmd and not an .exe: an .exe must be compiled (no toolchain for that in this repo, and a
// per-user binary cannot be built on the Railway Linux image), and without a code-signing certificate it
// gets the same "unknown publisher" warning as a script anyway. A .cmd is plain text, readable in
// Notepad before running, and every Windows 10/11 already has what it needs (cmd + Windows PowerShell
// 5.1 + .NET Framework). It is generated per download because it carries the user's own cfg.
//
// Security properties, each locked by gsi-windows-installer.test.ts:
// - The link token lives ONLY in the trailing data block. It is never in a command line (process-creation
//   audit logs record those) nor in the PowerShell code (script-block logging records that) -- the script
//   reads the block as data, validates its exact shape, and writes it. Nothing ever prints it.
// - The installer deletes itself when it finishes, so no extra copy of the credential stays in Downloads.
// - It touches exactly one file, `game\dota\cfg\gamestate_integration\gamestate_integration_d2kiro.cfg`
//   (creating the `gamestate_integration` folder when missing). It reads the Steam install path (two
//   registry values, nothing else under Steam's key) and `libraryfolders.vdf` (only `"path"` lines). It
//   never reads `userdata`, `loginusers.vdf`, `config.vdf` or app manifests (those carry account ids);
//   for the manifest it only checks that the file exists.
// - No network: the script has no web cmdlets or sockets. PowerShell is called by absolute path, so a
//   `powershell.exe` planted next to the downloaded file (Downloads is the working directory) is never run.
// - Steam/Dota not found, a tampered or truncated payload, or a write error: a plain message, exit != 0,
//   nothing written.

import { buildGsiConfig, GSI_CFG_FILENAME } from "./gsi-config";

export const GSI_WINDOWS_INSTALLER_FILENAME = "instalar-d2kiro-dota.cmd";
export const GSI_WINDOWS_UNINSTALLER_FILENAME = "quitar-d2kiro-dota.cmd";

const SCRIPT_BEGIN = "#D2KIRO-SCRIPT-BEGIN";
const SCRIPT_END = "#D2KIRO-SCRIPT-END";
const CFG_BEGIN = "#D2KIRO-CFG-BEGIN";
const CFG_END = "#D2KIRO-CFG-END";
const MAX_CFG_LENGTH = 4096;

const SHAPE_URI = `https://d2kiro.invalid/api/live/gsi/${"A".repeat(43)}`;
const SHAPE_TOKEN = "0".repeat(64);

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The whole cfg, whitespace-normalized, as one anchored regex. Derived from buildGsiConfig itself (the
 * uri and token swapped for their patterns), so the installer accepts exactly what the site generates --
 * a tampered file with an extra key, a second endpoint or a changed value is refused, and the template
 * cannot drift from the validator.
 */
const CFG_SHAPE_PATTERN = `^${escapeRegex(buildGsiConfig(SHAPE_URI, SHAPE_TOKEN).replace(/\s+/g, " ").trim())}$`
  .replace(escapeRegex(SHAPE_URI), "https://[A-Za-z0-9.-]+(?::[0-9]+)?/api/live/gsi/[A-Za-z0-9_-]{43}")
  .replace(SHAPE_TOKEN, "[0-9a-f]{64}");

/** Absolute path: cmd searches the current folder (= Downloads) first for a bare `powershell.exe`. */
const POWERSHELL = String.raw`"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"`;

// The bootstrap finds the script block by markers it builds by concatenation, so the markers it searches
// for never appear in this very line. No token, no user data: this is the only command line the installer
// produces.
const BOOTSTRAP = `${POWERSHELL} -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$t=[IO.File]::ReadAllText($env:D2KIRO_SELF);$m='#D2KIRO-'+'SCRIPT-';$a=$t.IndexOf($m+'BEGIN',[StringComparison]::Ordinal);$b=$t.IndexOf($m+'END',[StringComparison]::Ordinal);if($a -lt 0 -or $b -le $a){exit 4};& ([ScriptBlock]::Create($t.Substring($a,$b-$a)))"`;

// Windows PowerShell 5.1. Written without backticks and without "${" so it can live in a JS raw template.
// `D2KIRO_TEST_STEAM_ROOT` / `D2KIRO_TEST_NO_DIALOG` exist only for the Windows integration test: the
// first replaces Steam discovery with one folder (no registry, no drive scan), the second skips the dialog.
const POWERSHELL_SCRIPT = String.raw`${SCRIPT_BEGIN}
# D2KIRO -- conexion con Dota 2 (Game State Integration).
# Que hace: busca Dota 2 en tus bibliotecas de Steam y copia UN archivo,
#   gamestate_integration_d2kiro.cfg, en game\dota\cfg\gamestate_integration\ (o lo quita).
# Que NO hace: no toca ningun otro archivo de Dota ni de Steam, no lee tu cuenta de Steam,
#   no se conecta a internet y nunca muestra ni guarda en otro lado el contenido del archivo.
$ErrorActionPreference = 'Stop'
$CfgName = '${GSI_CFG_FILENAME}'
$DotaCfgRelative = 'steamapps\common\dota 2 beta\game\dota\cfg'
$LaunchOption = '-gamestateintegration'
$Mode = $env:D2KIRO_MODE
$NoDialog = $env:D2KIRO_TEST_NO_DIALOG -eq '1'
$NL = [Environment]::NewLine

function Show-Result([string]$Text, [bool]$Ok) {
  Write-Host ''
  Write-Host $Text
  Write-Host ''
  if ($NoDialog) { return }
  try {
    Add-Type -AssemblyName System.Windows.Forms
    $icon = [System.Windows.Forms.MessageBoxIcon]::Information
    if (-not $Ok) { $icon = [System.Windows.Forms.MessageBoxIcon]::Warning }
    [void][System.Windows.Forms.MessageBox]::Show($Text, 'D2KIRO', [System.Windows.Forms.MessageBoxButtons]::OK, $icon)
  } catch {
    [void](Read-Host 'Presioná Enter para cerrar')
  }
}

function Add-UniquePath($List, [string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) { return }
  try { $full = [IO.Path]::GetFullPath($Path.Trim().Replace('/', '\')) } catch { return }
  # Local drive letters only: a UNC path or a mapped network drive would make this script touch the network
  # (and could send the cfg to someone else's share). Steam does not keep its libraries there.
  if ($full -notmatch '^[A-Za-z]:\\') { return }
  try { if ((New-Object IO.DriveInfo($full.Substring(0, 1))).DriveType -eq [IO.DriveType]::Network) { return } } catch { return }
  if ($full.Length -gt 3) { $full = $full.TrimEnd('\') }
  foreach ($existing in $List) { if ($existing -ieq $full) { return } }
  [void]$List.Add($full)
}

function Get-SteamRoots {
  $roots = New-Object System.Collections.ArrayList
  if ($env:D2KIRO_TEST_STEAM_ROOT) { Add-UniquePath $roots $env:D2KIRO_TEST_STEAM_ROOT; return ,$roots }
  # Only the install path values -- never the rest of Steam's key (it also holds the login name).
  $sources = @(
    @('HKEY_CURRENT_USER\Software\Valve\Steam', 'SteamPath'),
    @('HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Valve\Steam', 'InstallPath'),
    @('HKEY_LOCAL_MACHINE\SOFTWARE\Valve\Steam', 'InstallPath')
  )
  foreach ($source in $sources) {
    $value = $null
    try { $value = [Microsoft.Win32.Registry]::GetValue($source[0], $source[1], $null) } catch { $value = $null }
    if ($value -is [string]) { Add-UniquePath $roots $value }
  }
  foreach ($name in @('ProgramFiles(x86)', 'ProgramFiles')) {
    $base = [Environment]::GetEnvironmentVariable($name)
    if ($base) { Add-UniquePath $roots ([IO.Path]::Combine($base, 'Steam')) }
  }
  return ,$roots
}

function Get-SteamLibraries($SteamRoots) {
  $libraries = New-Object System.Collections.ArrayList
  foreach ($root in $SteamRoots) {
    if (-not [IO.Directory]::Exists($root)) { continue }
    Add-UniquePath $libraries $root
    foreach ($relative in @('steamapps\libraryfolders.vdf', 'config\libraryfolders.vdf')) {
      $vdf = [IO.Path]::Combine($root, $relative)
      if (-not [IO.File]::Exists($vdf)) { continue }
      try { if ((New-Object IO.FileInfo($vdf)).Length -gt 1048576) { continue }; $lines = [IO.File]::ReadAllLines($vdf) } catch { continue }
      # Only library locations: "path" (current format) or a numbered key (old format) whose value is a path.
      foreach ($line in $lines) {
        if ($line -match '^\s*"(?:path|\d+)"\s+"((?:[^"\\]|\\.)*)"\s*$') {
          $path = $Matches[1] -replace '\\(.)', '$1'
          if ($path -match '^(?:[A-Za-z]:\\|\\\\)') { Add-UniquePath $libraries $path }
        }
      }
    }
  }
  return ,$libraries
}

# Last resort when Steam's own records lead nowhere: the usual library folders at each fixed drive's root.
function Get-FallbackLibraries {
  $libraries = New-Object System.Collections.ArrayList
  if ($env:D2KIRO_TEST_STEAM_ROOT) { return ,$libraries }
  foreach ($drive in [IO.DriveInfo]::GetDrives()) {
    $usable = $false
    try { $usable = $drive.DriveType -eq [IO.DriveType]::Fixed -and $drive.IsReady } catch { $usable = $false }
    if (-not $usable) { continue }
    foreach ($relative in @('SteamLibrary', 'Steam', 'Games\Steam', 'Games\SteamLibrary', 'Program Files (x86)\Steam', 'Program Files\Steam')) {
      Add-UniquePath $libraries ([IO.Path]::Combine($drive.RootDirectory.FullName, $relative))
    }
  }
  return ,$libraries
}

# A valid Dota install has steamapps\common\dota 2 beta\game\dota\cfg. Libraries where Steam has Dota's
# manifest win over leftover copies; the manifest is only checked for existence, never read.
function Find-DotaCfgFolders($Libraries, [bool]$IncludeLeftovers) {
  $registered = New-Object System.Collections.ArrayList
  $leftovers = New-Object System.Collections.ArrayList
  foreach ($library in $Libraries) {
    $cfg = [IO.Path]::Combine($library, $DotaCfgRelative)
    if (-not [IO.Directory]::Exists($cfg)) { continue }
    if ([IO.File]::Exists([IO.Path]::Combine($library, 'steamapps\appmanifest_570.acf'))) { Add-UniquePath $registered $cfg } else { Add-UniquePath $leftovers $cfg }
  }
  if ($IncludeLeftovers) { foreach ($cfg in $leftovers) { Add-UniquePath $registered $cfg } }
  if ($registered.Count -gt 0) { return ,$registered }
  return ,$leftovers
}

# The cfg rides at the end of this file as data. Exact shape or nothing: the very file the site generates
# (one https uri to the D2KIRO ingest path, one 64-hex token, fixed keys), printable ASCII only.
function Read-Payload {
  $self = [IO.File]::ReadAllText($env:D2KIRO_SELF)
  $begin = '#D2KIRO-' + 'CFG-BEGIN'
  $end = '#D2KIRO-' + 'CFG-END'
  $i = $self.IndexOf($begin, [StringComparison]::Ordinal)
  $j = $self.IndexOf($end, [StringComparison]::Ordinal)
  if ($i -lt 0 -or $j -le $i) { return $null }
  $cfg = $self.Substring($i + $begin.Length, $j - $i - $begin.Length).Trim()
  if ($cfg.Length -gt ${MAX_CFG_LENGTH} -or -not $cfg.StartsWith('"D2KIRO"', [StringComparison]::Ordinal)) { return $null }
  if ($cfg -cmatch '[^\x09\x0A\x0D\x20-\x7E]') { return $null }
  if ([regex]::Replace($cfg, '\s+', ' ') -cnotmatch '${CFG_SHAPE_PATTERN}') { return $null }
  return $cfg + $NL
}

function Find-AllDotaCfgFolders([bool]$IncludeLeftovers) {
  $folders = Find-DotaCfgFolders (Get-SteamLibraries (Get-SteamRoots)) $IncludeLeftovers
  if ($folders.Count -eq 0 -or $IncludeLeftovers) {
    foreach ($cfg in (Find-DotaCfgFolders (Get-FallbackLibraries) $IncludeLeftovers)) { Add-UniquePath $folders $cfg }
  }
  return ,$folders
}

$NotFound = 'No encontramos Dota 2 en esta PC.' + $NL + $NL + 'Buscamos en todas tus bibliotecas de Steam (C:, D: y las demás). Si Dota 2 está instalado, volvé a la página de D2KIRO y usá «Instalarlo a mano».' + $NL + $NL + 'No se cambió nada.'

if ($Mode -eq 'uninstall') {
  try {
    $removed = 0
    foreach ($cfg in (Find-AllDotaCfgFolders $true)) {
      $file = [IO.Path]::Combine([IO.Path]::Combine($cfg, 'gamestate_integration'), $CfgName)
      if ([IO.File]::Exists($file)) { [IO.File]::Delete($file); $removed++ }
    }
  } catch {
    Show-Result ('No pudimos quitar la configuración de D2KIRO. Cerrá Dota 2 y probá de nuevo.') $false
    exit 3
  }
  if ($removed -eq 0) { Show-Result ('No había ninguna configuración de D2KIRO instalada en Dota 2.' + $NL + $NL + 'No se cambió nada.') $true; exit 0 }
  Show-Result ('Listo: se quitó la configuración de D2KIRO de Dota 2.' + $NL + $NL + 'Reiniciá Dota 2. Para cortar también la conexión desde el sitio, usá «Desconectar Dota» en la página de D2KIRO.') $true
  exit 0
}

if ($Mode -ne 'install') { exit 4 }

$cfgText = $null
try { $cfgText = Read-Payload } catch { $cfgText = $null }
if ($null -eq $cfgText) {
  Show-Result ('Este instalador está incompleto o fue modificado.' + $NL + $NL + 'Descargá uno nuevo desde la página de D2KIRO. No se cambió nada.') $false
  exit 4
}

$folders = Find-AllDotaCfgFolders $false
if ($folders.Count -eq 0) { Show-Result $NotFound $false; exit 2 }

$installed = New-Object System.Collections.ArrayList
foreach ($cfg in $folders) {
  $dir = [IO.Path]::Combine($cfg, 'gamestate_integration')
  try {
    [void][IO.Directory]::CreateDirectory($dir)
    [IO.File]::WriteAllText([IO.Path]::Combine($dir, $CfgName), $cfgText, (New-Object System.Text.UTF8Encoding($false)))
    [void]$installed.Add($dir)
  } catch {
    Show-Result ('No pudimos guardar el archivo en:' + $NL + $dir + $NL + $NL + 'Cerrá Dota 2 y probá de nuevo descargando otro instalador. Si se repite, usá «Instalarlo a mano» en la página de D2KIRO.') $false
    exit 3
  }
}

$copied = $false
if (-not $NoDialog) { try { Set-Clipboard -Value $LaunchOption; $copied = $true } catch { $copied = $false } }
$launchHint = 'Si todavía no lo hiciste: en Steam, clic derecho en Dota 2 > Propiedades > General > Opciones de lanzamiento, agregá ' + $LaunchOption
if ($copied) { $launchHint = $launchHint + ' (ya está copiado: solo pegalo).' } else { $launchHint = $launchHint + '.' }
$restart = 'Último paso: abrí Dota 2.'
if (Get-Process -Name 'dota2' -ErrorAction SilentlyContinue) { $restart = 'Último paso: Dota 2 está abierto, cerralo y volvelo a abrir.' }
Show-Result ('Listo: D2KIRO quedó conectado con Dota 2.' + $NL + $NL + 'Carpeta: ' + ($installed -join $NL) + $NL + $NL + $restart + ' La página de D2KIRO pasa sola a «Dota conectado».' + $NL + $NL + $launchHint + $NL + $NL + 'Este instalador ya se borró solo: tenía tu conexión personal.') $true
exit 0
${SCRIPT_END}`;

function header(mode: "install" | "uninstall", title: string, lines: readonly string[]): string[] {
  return [
    "@echo off",
    ...lines.map((line) => `rem ${line}`),
    "setlocal DisableDelayedExpansion",
    `title ${title}`,
    "echo.",
    `echo   ${title}...`,
    "echo.",
    'set "D2KIRO_SELF=%~f0"',
    `set "D2KIRO_MODE=${mode}"`,
    BOOTSTRAP,
  ];
}

function toCrlf(lines: readonly string[]): string {
  // cmd.exe mis-parses batch files with bare LF line endings; everything is normalized to CRLF.
  return lines.join("\n").replace(/\r\n/g, "\n").replace(/\n/g, "\r\n") + "\r\n";
}

function assertEmbeddableCfg(cfg: string): void {
  const trimmed = cfg.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_CFG_LENGTH) throw new Error("invalid GSI cfg for installer");
  if (!trimmed.startsWith('"D2KIRO"')) throw new Error("invalid GSI cfg for installer");
  if (/[^\x09\x0A\x0D\x20-\x7E]/.test(trimmed) || trimmed.includes("#D2KIRO-")) throw new Error("invalid GSI cfg for installer");
}

/** The per-user installer: installs `cfg` into every valid Dota folder found, then deletes itself. */
export function buildWindowsGsiInstaller(cfg: string): string {
  assertEmbeddableCfg(cfg);
  return toCrlf([
    ...header("install", "D2KIRO - Conectar Dota 2", [
      "D2KIRO - instalador de la conexion con Dota 2 (Game State Integration).",
      `Copia UN archivo (${GSI_CFG_FILENAME}) en la carpeta de integraciones de Dota 2.`,
      "No toca ningun otro archivo, no lee tu cuenta de Steam y no se conecta a internet.",
      "Contiene tu conexion personal con D2KIRO: no lo compartas. Se borra solo al terminar.",
    ]),
    'set "D2KIRO_EXIT=%ERRORLEVEL%"',
    // `(goto)` ends the batch first, so the file can delete itself; the exit code was captured above.
    // Nothing below this line is batch code.
    '(goto) 2>nul & del "%~f0" & exit /b %D2KIRO_EXIT%',
    POWERSHELL_SCRIPT,
    CFG_BEGIN,
    cfg.trim(),
    CFG_END,
  ]);
}

/** The uninstaller: removes only `gamestate_integration_d2kiro.cfg` from every Dota folder found. No credential inside. */
export function buildWindowsGsiUninstaller(): string {
  return toCrlf([
    ...header("uninstall", "D2KIRO - Quitar la conexion con Dota 2", [
      "D2KIRO - quita la conexion con Dota 2 (Game State Integration).",
      `Borra solo ${GSI_CFG_FILENAME} de la carpeta de integraciones de Dota 2.`,
      "No toca ningun otro archivo, no lee tu cuenta de Steam y no se conecta a internet.",
    ]),
    "exit /b %ERRORLEVEL%",
    POWERSHELL_SCRIPT,
  ]);
}
