import { GSI_CFG_FILENAME } from "@/lib/gsi-config";
import { CFG_SHAPE_PATTERN, DOTA_DISCOVERY_PS } from "@/lib/gsi-windows-installer";
import { VISUAL_SUPERVISOR_PS } from "./companion-visual";

// D2KIRO Companion V0 -- the PowerShell that runs on the Player's PC. Pure strings, no I/O here.
//
// SERVER-ONLY (apps/web/server/): imported only by the download route (app/api/live/companion-installer). This text
// is never executed by a browser -- it is the payload of a file the Player runs on their own PC, which is why its
// 127.0.0.1 literals are correct here and why it does not live under features/lib/components (TSK-214 gate:
// browser code must never point at a loopback).
//
// Windows PowerShell 5.1 + .NET Framework 4.x only: every Windows 10/11 already has them, so the Companion
// installs from ONE downloaded .cmd with nothing else to install (same reasoning as lib/gsi-windows-installer).
// Written without backticks and without "${" so it can live in a JS raw template.
//
// Data path:   Dota 2 --GSI--> http://127.0.0.1:<port>/gsi --Companion--> https://<site>/api/live/gsi/<liveId>
//   * Dota's cfg points at THIS PC with a LOCAL token (never the link token): the link token stays with the
//     Companion, encrypted at rest with DPAPI (CurrentUser).
//   * Only the sections D2KIRO's own cfg always sent are forwarded (FORWARD_SECTIONS): the extra research
//     sections Dota now reports stay on this PC, in diagnostics\.
//   * The server side is unchanged: the same link-authenticated ingest the downloaded cfg used.
//
// Local surface (127.0.0.1 only, Host header checked against DNS rebinding):
//   POST /gsi                          Dota, local token
//   GET  /health                       status without identity; CORS only for the paired D2KIRO origin
//   POST /relay/api/live/visual/<any>  the local visual helper, local token -> relayed with the link token
//
// Test-only switches (never set in production; same convention as the GSI installer):
//   D2KIRO_COMPANION_HOME     install folder instead of %LOCALAPPDATA%\D2KIRO\Companion
//   D2KIRO_COMPANION_PORT     first port to try (installer)
//   D2KIRO_TEST_UPSTREAM      send to this base URL instead of the paired https origin (fake server)
//   D2KIRO_TEST_STEAM_ROOT    one fake Steam root (lib/gsi-windows-installer discovery)
//   D2KIRO_TEST_NO_DIALOG     no message boxes
//   D2KIRO_TEST_NO_AUTOSTART  no registry writes (Run key / Apps list)
//   D2KIRO_TEST_NO_START      the installer does not launch the runtime
//   D2KIRO_TEST_CFG_SYNC_SECONDS  Dota cfg check period instead of 30 s

export const COMPANION_VERSION = "0.1.0";
export const COMPANION_DEFAULT_PORT = 53120;
/** What leaves the PC: exactly the sections of the cfg D2KIRO already handed out (lib/gsi-config). */
export const COMPANION_FORWARD_SECTIONS = ["provider", "map", "player", "hero", "draft", "abilities", "items"] as const;
/** What Dota is asked to report locally: everything GSI offers, so the next real match answers the research question. */
export const COMPANION_LOCAL_SECTIONS = [
  "provider", "map", "player", "hero", "abilities", "items", "draft", "wearables", "buildings", "league", "events",
  "minimap", "roshan", "couriers", "neutralitems",
] as const;
export const COMPANION_PHASES = ["MENU", "LOADING", "HERO_SELECTION", "STRATEGY_TIME", "MATCH", "POST_GAME", "OTHER"] as const;

const psList = (items: readonly string[]) => items.map((item) => `'${item}'`).join(",");

/** Shared by the installer and the runtime: paths, config (DPAPI), remote-link parsing, local cfg, logging. */
const COMMON_PS = String.raw`
$CompanionVersion = '${COMPANION_VERSION}'
$DefaultPort = ${COMPANION_DEFAULT_PORT}
$CfgName = '${GSI_CFG_FILENAME}'
$NL = [Environment]::NewLine
$CRLF = [string][char]13 + [string][char]10
$Mode = $env:D2KIRO_COMPANION_MODE
$NoDialog = $env:D2KIRO_TEST_NO_DIALOG -eq '1'
$NoAutostart = $env:D2KIRO_TEST_NO_AUTOSTART -eq '1'
$AppDir = $env:D2KIRO_COMPANION_HOME
if (-not $AppDir) { $AppDir = [IO.Path]::Combine($env:LOCALAPPDATA, 'D2KIRO\Companion') }
$AppDir = [IO.Path]::GetFullPath($AppDir)
$RuntimePath = [IO.Path]::Combine($AppDir, 'companion.ps1')
$ConfigPath = [IO.Path]::Combine($AppDir, 'config.json')
$UninstallCmdPath = [IO.Path]::Combine($AppDir, 'desinstalar-d2kiro-companion.cmd')
$DiagDir = [IO.Path]::Combine($AppDir, 'diagnostics')
$LogPath = [IO.Path]::Combine($AppDir, 'companion.log')
$RunKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$RunValue = 'D2KIRO Companion'
$UninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\D2KIROCompanion'
$Entropy = [Text.Encoding]::UTF8.GetBytes('d2kiro-companion/v1')
Add-Type -AssemblyName System.Web.Extensions
Add-Type -AssemblyName System.Security
$Json = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$Json.MaxJsonLength = 8388608
$Json.RecursionLimit = 64

function New-Doc { return ,(New-Object 'System.Collections.Generic.Dictionary[string,object]') }
# Every value stored in a document goes through here: anything a function returned (or a cast produced) carries a
# PSObject wrapper that JavaScriptSerializer cannot serialize ("circular reference").
function Set-Field($Doc, $Key, $Value) {
  if ($null -ne $Value) { $Value = $Value.psobject.BaseObject }
  $Doc[$Key] = $Value
}

function Write-Log([string]$Message) {
  try {
    [void][IO.Directory]::CreateDirectory($AppDir)
    if ([IO.File]::Exists($LogPath) -and (New-Object IO.FileInfo($LogPath)).Length -gt 524288) {
      $old = $LogPath + '.1'
      if ([IO.File]::Exists($old)) { [IO.File]::Delete($old) }
      [IO.File]::Move($LogPath, $old)
    }
    [IO.File]::AppendAllText($LogPath, [DateTime]::UtcNow.ToString('o') + ' ' + $Message + $NL, (New-Object System.Text.UTF8Encoding($false)))
  } catch { }
}

function Show-Result([string]$Text, [bool]$Ok) {
  Write-Host ''
  Write-Host $Text
  Write-Host ''
  if ($NoDialog) { return }
  try {
    Add-Type -AssemblyName System.Windows.Forms
    $icon = [System.Windows.Forms.MessageBoxIcon]::Information
    if (-not $Ok) { $icon = [System.Windows.Forms.MessageBoxIcon]::Warning }
    [void][System.Windows.Forms.MessageBox]::Show($Text, 'D2KIRO Companion', [System.Windows.Forms.MessageBoxButtons]::OK, $icon)
  } catch { }
}

function Protect-Secret([string]$Text) {
  $bytes = [Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($Text), $Entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  return [Convert]::ToBase64String($bytes)
}

function Unprotect-Secret([string]$Blob) {
  if (-not $Blob) { return $null }
  try {
    $bytes = [Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($Blob), $Entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    return [Text.Encoding]::UTF8.GetString($bytes)
  } catch { return $null }
}

function New-HexToken {
  $bytes = New-Object byte[] 32
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($bytes)
  $rng.Dispose()
  return -join ($bytes | ForEach-Object { $_.ToString('x2') })
}

# A cfg D2KIRO's site generated (direct Dota -> https link) -> its origin, live id and link token. Exact shape or
# nothing: the same anchored pattern the GSI installer validates with. Never printed, never logged.
function Read-RemoteLink([string]$Text) {
  if ($null -eq $Text -or $Text.Length -gt 4096) { return $null }
  $t = $Text.Trim()
  if ($t -cmatch '[^\x09\x0A\x0D\x20-\x7E]') { return $null }
  if ([regex]::Replace($t, '\s+', ' ') -cnotmatch '${CFG_SHAPE_PATTERN}') { return $null }
  $uri = [regex]::Match($t, '"uri"\s+"(https://[A-Za-z0-9.-]+(?::[0-9]+)?)/api/live/gsi/([A-Za-z0-9_-]{43})"')
  $key = [regex]::Match($t, '"token"\s+"([0-9a-f]{64})"')
  if (-not $uri.Success -or -not $key.Success) { return $null }
  return @{ origin = $uri.Groups[1].Value; liveId = $uri.Groups[2].Value; token = $key.Groups[1].Value }
}

# The cfg Dota gets from the Companion: this PC only, a local token, every section (research stays local).
function Get-LocalCfg([int]$Port, [string]$LocalToken) {
  $lines = New-Object System.Collections.ArrayList
  foreach ($line in @('"D2KIRO"', '{', ('    "uri"           "http://127.0.0.1:' + $Port + '/gsi"'), '    "timeout"       "5.0"', '    "buffer"        "0.1"', '    "throttle"      "0.1"', '    "heartbeat"     "5.0"', '    "data"', '    {')) { [void]$lines.Add($line) }
  foreach ($section in @(${psList(COMPANION_LOCAL_SECTIONS)})) { [void]$lines.Add('        "' + $section + '"' + (' ' * [Math]::Max(1, 14 - $section.Length)) + '"1"') }
  foreach ($line in @('    }', '    "auth"', '    {', ('        "token"         "' + $LocalToken + '"'), '    }', '}')) { [void]$lines.Add($line) }
  return ([string]::Join($NL, [string[]]$lines.ToArray()) + $NL)
}

# config.json: origin, live id, local token and port in clear; the link token DPAPI-encrypted (CurrentUser).
# A link token that cannot be decrypted (other Windows user, corrupted file) leaves the Companion unpaired.
function Read-CompanionConfig {
  if (-not [IO.File]::Exists($ConfigPath)) { return $null }
  try {
    $raw = $Json.DeserializeObject([IO.File]::ReadAllText($ConfigPath))
    if ($raw -isnot [Collections.IDictionary] -or $raw['schema'] -ne 'd2kiro-companion-config/v1') { return $null }
    $localToken = [string]$raw['localToken']
    $port = 0
    if (-not [int]::TryParse([string]$raw['port'], [ref]$port)) { return $null }
    if ($localToken -cnotmatch '^[0-9a-f]{64}$' -or $port -lt 1024 -or $port -gt 65535) { return $null }
    $origin = [string]$raw['siteOrigin']
    $liveId = [string]$raw['liveId']
    $token = Unprotect-Secret ([string]$raw['linkToken'])
    if ($origin -cnotmatch '^https://[A-Za-z0-9.-]+(?::[0-9]+)?$' -or $liveId -cnotmatch '^[A-Za-z0-9_-]{43}$' -or $null -eq $token -or $token -cnotmatch '^[0-9a-f]{64}$') { $origin = $null; $liveId = $null; $token = $null }
    return @{ origin = $origin; liveId = $liveId; token = $token; localToken = $localToken; port = $port }
  } catch { return $null }
}

function Write-CompanionConfig($Config) {
  $doc = New-Doc
  Set-Field $doc 'schema' ('d2kiro-companion-config/v1')
  Set-Field $doc 'siteOrigin' ($Config.origin)
  Set-Field $doc 'liveId' ($Config.liveId)
  Set-Field $doc 'linkToken' ($null)
  if ($Config.token) { Set-Field $doc 'linkToken' (Protect-Secret $Config.token) }
  Set-Field $doc 'localToken' ($Config.localToken)
  Set-Field $doc 'port' ([int]$Config.port)
  Set-Field $doc 'companionVersion' ($CompanionVersion)
  [void][IO.Directory]::CreateDirectory($AppDir)
  $tmp = $ConfigPath + '.tmp'
  [IO.File]::WriteAllText($tmp, $Json.Serialize($doc), (New-Object System.Text.UTF8Encoding($false)))
  if ([IO.File]::Exists($ConfigPath)) { [IO.File]::Replace($tmp, $ConfigPath, [NullString]::Value) } else { [IO.File]::Move($tmp, $ConfigPath) }
}

# Other running copies of THIS Companion (same script path), never the current process.
function Stop-OtherCompanions {
  try {
    foreach ($process in (Get-CimInstance -ClassName Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction Stop)) {
      if ($process.ProcessId -eq $PID) { continue }
      $command = [string]$process.CommandLine
      if ($command -and $command.IndexOf($RuntimePath, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
        try { Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop } catch { }
      }
    }
  } catch { }
}

function Get-LaunchCommand {
  $powershell = [IO.Path]::Combine($env:SystemRoot, 'System32\WindowsPowerShell\v1.0\powershell.exe')
  $conhost = [IO.Path]::Combine($env:SystemRoot, 'System32\conhost.exe')
  $arguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $RuntimePath + '"'
  # conhost --headless (Windows 10 1809+): no console window at all, not even a flash at logon.
  if ([Environment]::OSVersion.Version.Build -ge 17763 -and [IO.File]::Exists($conhost)) { return @{ file = $conhost; arguments = '--headless "' + $powershell + '" ' + $arguments } }
  return @{ file = $powershell; arguments = $arguments }
}
`;

/** One definition of the upstream POST, dot-sourced in the main thread and prepended to the worker runspace. */
const UPSTREAM_PS = String.raw`
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
[Net.ServicePointManager]::Expect100Continue = $false
function Send-Upstream([string]$Url, [string]$Body, [int]$TimeoutMs, [string]$Version) {
  try {
    $request = [Net.HttpWebRequest]::Create($Url)
    $request.Method = 'POST'
    $request.ContentType = 'application/json'
    $request.Timeout = $TimeoutMs
    $request.ReadWriteTimeout = $TimeoutMs
    $request.UserAgent = 'D2KIRO-Companion/' + $Version
    # Never follow a redirect: a site without this route answers 3xx -> /login, whose 200 is not an acceptance.
    $request.AllowAutoRedirect = $false
    $bytes = [Text.Encoding]::UTF8.GetBytes($Body)
    $request.ContentLength = $bytes.Length
    $stream = $request.GetRequestStream()
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Close()
    $response = $request.GetResponse()
    $code = [int]$response.StatusCode
    $reader = New-Object IO.StreamReader($response.GetResponseStream())
    $buffer = New-Object char[] 2048
    $read = $reader.Read($buffer, 0, $buffer.Length)
    $response.Close()
    $text = ''
    if ($read -gt 0) { $text = New-Object string($buffer, 0, $read) }
    return @{ code = $code; body = $text }
  } catch [Net.WebException] {
    $failed = $_.Exception.Response
    if ($null -ne $failed) { $code = [int]$failed.StatusCode; $failed.Close(); return @{ code = $code; body = '' } }
    return @{ code = 0; body = '' }
  } catch { return @{ code = 0; body = '' } }
}
`;

/**
 * The upstream worker (own runspace): sends the LATEST Dota state (coalesced -- GSI repeats the whole state on
 * every update, so only the newest matters), retries with backoff, and sends the Companion heartbeat. Reconnect
 * is implicit: after any outage the next attempt carries the current state.
 */
const WORKER_PS = String.raw`
function Get-Base { if ($Shared.TestUpstream) { return $Shared.TestUpstream }; return $Shared.Origin }
function Add-Auth([string]$JsonText) {
  $prefix = '{"auth":{"token":"' + $Shared.Token + '"}'
  if ($JsonText.Length -le 2) { return $prefix + '}' }
  return $prefix + ',' + $JsonText.Substring(1)
}
$sentSeq = 0
$backoffMs = 0
$nextSend = [DateTime]::MinValue
$heartbeatNext = [DateTime]::MinValue
$heartbeatLast = [DateTime]::MinValue
$linkVersion = $Shared.LinkVersion
while (-not $Shared.Stop) {
  $now = [DateTime]::UtcNow
  if ($Shared.LinkVersion -ne $linkVersion) { $linkVersion = $Shared.LinkVersion; $backoffMs = 0; $nextSend = [DateTime]::MinValue; $heartbeatNext = [DateTime]::MinValue }
  $paired = [bool]$Shared.Token
  if ($paired -and $Shared.Seq -gt $sentSeq -and $now -ge $nextSend) {
    $seq = $Shared.Seq
    $result = Send-Upstream ((Get-Base) + '/api/live/gsi/' + $Shared.LiveId) (Add-Auth ([string]$Shared.Payload)) 5000 $Shared.Version
    $code = $result.code
    $Shared.LastUpstreamCode = $code
    if ($code -eq 200) { $Shared.Upstream = 'ok'; $Shared.LastOkAt = [DateTime]::UtcNow; $sentSeq = $seq; $backoffMs = 0 }
    elseif ($code -eq 401) { $Shared.Upstream = 'unauthorized'; $sentSeq = $seq; $nextSend = $now.AddSeconds(30) }
    elseif ($code -eq 400 -or $code -eq 413) { $Shared.Upstream = 'rejected'; $sentSeq = $seq }
    else {
      if ($code -eq 409) { $Shared.Upstream = 'unavailable' } elseif ($code -eq 429) { $Shared.Upstream = 'throttled' } else { $Shared.Upstream = 'offline' }
      $backoffMs = [Math]::Min(30000, [Math]::Max(1000, $backoffMs * 2))
      $nextSend = $now.AddMilliseconds($backoffMs)
    }
  }
  $heartbeatDue = $now -ge $heartbeatNext -or ($Shared.HeartbeatDirty -and ($now - $heartbeatLast).TotalSeconds -ge 2)
  if ($paired -and $heartbeatDue) {
    $Shared.HeartbeatDirty = $false
    $heartbeatLast = $now
    $phase = 'null'
    if ($Shared.HbPhase) { $phase = '"' + $Shared.HbPhase + '"' }
    $restart = 'false'
    if ($Shared.HbRestart) { $restart = 'true' }
    $visual = ''
    if ($Shared.HbVisual) { $visual = ',"visual":"' + $Shared.HbVisual + '"' }
    $body = '{"auth":{"token":"' + $Shared.Token + '"},"companion":{"schema":"companion-heartbeat/v1","version":"' + $Shared.Version + '","dota":"' + $Shared.HbDota + '","phase":' + $phase + ',"restartNeeded":' + $restart + $visual + '}}'
    $code = (Send-Upstream ((Get-Base) + '/api/live/companion/' + $Shared.LiveId) $body 5000 $Shared.Version).code
    if ($code -eq 200) { $heartbeatNext = $now.AddSeconds(15); $Shared.HeartbeatSupported = $true; $Shared.Upstream = 'ok'; $Shared.LastOkAt = [DateTime]::UtcNow }
    elseif ($code -eq 404 -or ($code -ge 300 -and $code -lt 400)) { $heartbeatNext = $now.AddMinutes(5); $Shared.HeartbeatSupported = $false }
    elseif ($code -eq 401) { $Shared.Upstream = 'unauthorized'; $heartbeatNext = $now.AddSeconds(60) }
    else { if ($code -eq 0) { $Shared.Upstream = 'offline' }; $heartbeatNext = $now.AddSeconds(15) }
  }
  Start-Sleep -Milliseconds 50
}
`;

/** The long-running Companion (companion.ps1). Modes: run (default) and uninstall (D2KIRO_COMPANION_MODE). */
export const COMPANION_RUNTIME_PS = String.raw`# D2KIRO Companion ${COMPANION_VERSION} -- corre en segundo plano en tu PC (Windows PowerShell, nada extra que instalar).
# Que hace:
#   - mantiene ${GSI_CFG_FILENAME} en Dota 2 apuntando a ESTA PC (127.0.0.1);
#   - recibe lo que Dota informa (Game State Integration) y lo reenvia a tu sesion en vivo de D2KIRO,
#     solo las secciones que D2KIRO ya usaba (${COMPANION_FORWARD_SECTIONS.join(", ")});
#   - guarda diagnosticos SOLO en esta PC (diagnostics\), acotados y rotados, sin el token de conexion.
# Que NO hace: no pide tu cuenta de Steam, no lee la memoria de Dota, no sube los diagnosticos a ningun lado.
$ErrorActionPreference = 'Stop'
${COMMON_PS}
${DOTA_DISCOVERY_PS}

$UpstreamCode = @'
${UPSTREAM_PS}
'@
. ([ScriptBlock]::Create($UpstreamCode))
$WorkerCode = $UpstreamCode + @'
${WORKER_PS}
'@

$ForwardSections = @(${psList(COMPANION_FORWARD_SECTIONS)})
$Latin1 = [Text.Encoding]::GetEncoding(28591)
$HeaderTerminator = $CRLF + $CRLF
$GsiMaxBytes = 2097152
$RelayMaxBytes = 4096
$RawMaxFileBytes = 16777216
$RawMaxTotalBytes = 167772160
$MatchSampleMs = 2000
$InventoryKeep = 30
$CfgSyncSeconds = 30
if ($env:D2KIRO_TEST_CFG_SYNC_SECONDS -match '^[0-9]{1,3}$') { $CfgSyncSeconds = [int]$env:D2KIRO_TEST_CFG_SYNC_SECONDS }

function Invoke-Uninstall {
  Stop-OtherCompanions
  # The visual helper goes with the Companion that supervised it.
  $visualRoot = [IO.Path]::Combine($AppDir, 'visual')
  foreach ($process in (Get-Process -Name 'd2kiro-visual' -ErrorAction SilentlyContinue)) { try { if (([string]$process.Path).StartsWith($visualRoot, [StringComparison]::OrdinalIgnoreCase)) { Stop-Process -Id $process.Id -Force -ErrorAction Stop } } catch { } }
  try { if ([IO.Directory]::Exists($visualRoot)) { [IO.Directory]::Delete($visualRoot, $true) } } catch { }
  if (-not $NoAutostart) {
    try { Remove-ItemProperty -Path $RunKey -Name $RunValue -ErrorAction Stop } catch { }
    try { Remove-Item -Path $UninstallKey -Recurse -ErrorAction Stop } catch { }
  }
  $removed = 0
  foreach ($cfgDir in (Find-AllDotaCfgFolders $true)) {
    $file = [IO.Path]::Combine([IO.Path]::Combine($cfgDir, 'gamestate_integration'), $CfgName)
    try { if ([IO.File]::Exists($file)) { [IO.File]::Delete($file); $removed++ } } catch { }
  }
  # Everything the Companion installed goes, except the local diagnostics (yours, never uploaded) and the
  # uninstaller .cmd that is running this (it deletes itself when this script returns).
  foreach ($path in @($RuntimePath, $ConfigPath, ($ConfigPath + '.tmp'), $LogPath, ($LogPath + '.1'))) { try { if ([IO.File]::Exists($path)) { [IO.File]::Delete($path) } } catch { } }
  $text = 'D2KIRO Companion se desinstalo: ya no arranca con Windows y se quito la configuracion de Dota 2.'
  if ([IO.Directory]::Exists($DiagDir)) { $text = $text + $NL + $NL + 'Los diagnosticos locales quedaron en:' + $NL + $DiagDir + $NL + 'Puedes borrar esa carpeta cuando quieras.' }
  Show-Result ($text + $NL + $NL + 'Para cortar tambien la conexion desde el sitio, usa «Desconectar Dota» en la pagina de D2KIRO.') $true
}

if ($Mode -eq 'uninstall') { Invoke-Uninstall; exit 0 }

# ---------------------------------------------------------------- run --------------------------------------
$Config = Read-CompanionConfig
if ($null -eq $Config) { Write-Log 'no valid config.json: reinstall D2KIRO Companion'; exit 3 }

$appKey = -join ([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($AppDir.ToLowerInvariant())) | Select-Object -First 8 | ForEach-Object { $_.ToString('x2') })
$createdMutex = $false
$Mutex = New-Object System.Threading.Mutex($true, ('Local\D2KIRO-Companion-' + $appKey), [ref]$createdMutex)
if (-not $createdMutex) { Write-Log 'another Companion is already running'; exit 0 }

$Listener = $null
$Port = 0
for ($candidate = $Config.port; $candidate -lt $Config.port + 10; $candidate++) {
  try {
    $attempt = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $candidate)
    $attempt.ExclusiveAddressUse = $true
    $attempt.Start()
    $Listener = $attempt
    $Port = $candidate
    break
  } catch { }
}
if ($null -eq $Listener) { Write-Log 'no free local port'; exit 1 }
if ($Port -ne $Config.port) { $Config.port = $Port; Write-CompanionConfig $Config; Write-Log ('moved to port ' + $Port) }

$Shared = [hashtable]::Synchronized(@{})
$Shared.Origin = $Config.origin
$Shared.LiveId = $Config.liveId
$Shared.Token = $Config.token
$Shared.LinkVersion = 1
$Shared.Seq = 0
$Shared.Payload = '{}'
$Shared.Upstream = 'connecting'
if (-not $Config.token) { $Shared.Upstream = 'unpaired' }
$Shared.LastOkAt = $null
$Shared.LastUpstreamCode = 0
$Shared.Stop = $false
$Shared.Version = $CompanionVersion
$Shared.TestUpstream = $env:D2KIRO_TEST_UPSTREAM
$Shared.HbDota = 'not_running'
$Shared.HbPhase = $null
$Shared.HbRestart = $false
$Shared.HbVisual = 'absent'
$Shared.HeartbeatDirty = $true
$Shared.HeartbeatSupported = $true

$S = @{
  phase = 'MENU'; gameState = $null; lastGsiAt = [DateTime]::MinValue
  dotaRunning = $false; dotaStart = $null; restartNeeded = $false; cfgWrittenAt = $null; cfgInstalled = $false
  cfgDirs = @(); lastDiscovery = [DateTime]::MinValue; lastCfgSync = [DateTime]::MinValue; lastProcCheck = [DateTime]::MinValue
  lastDota = ''; lastPhase = ''; lastVisual = ''
}
$D = @{
  writer = $null; part = 0; runId = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss'); seq = 0
  lastRecordAt = [DateTime]::MinValue; lastKeys = ''; lastGameState = ''
  phases = @{}; dirty = $false; savedAt = [DateTime]::MinValue
}
$Worker = $null

function Start-Worker {
  $runspace = [RunspaceFactory]::CreateRunspace()
  $runspace.Open()
  $runspace.SessionStateProxy.SetVariable('Shared', $Shared)
  $shell = [PowerShell]::Create()
  $shell.Runspace = $runspace
  [void]$shell.AddScript($WorkerCode)
  $script:Worker = @{ shell = $shell; handle = $shell.BeginInvoke() }
}

function Get-Phase($GameState) {
  if (-not $GameState) { return 'MENU' }
  switch ([string]$GameState) {
    'DOTA_GAMERULES_STATE_INIT' { return 'LOADING' }
    'DOTA_GAMERULES_STATE_WAIT_FOR_PLAYERS_TO_LOAD' { return 'LOADING' }
    'DOTA_GAMERULES_STATE_CUSTOM_GAME_SETUP' { return 'LOADING' }
    'DOTA_GAMERULES_STATE_HERO_SELECTION' { return 'HERO_SELECTION' }
    'DOTA_GAMERULES_STATE_PLAYER_DRAFT' { return 'HERO_SELECTION' }
    'DOTA_GAMERULES_STATE_STRATEGY_TIME' { return 'STRATEGY_TIME' }
    'DOTA_GAMERULES_STATE_TEAM_SHOWCASE' { return 'MATCH' }
    'DOTA_GAMERULES_STATE_WAIT_FOR_MAP_TO_LOAD' { return 'MATCH' }
    'DOTA_GAMERULES_STATE_PRE_GAME' { return 'MATCH' }
    'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS' { return 'MATCH' }
    'DOTA_GAMERULES_STATE_POST_GAME' { return 'POST_GAME' }
    'DOTA_GAMERULES_STATE_DISCONNECT' { return 'POST_GAME' }
  }
  return 'OTHER'
}

function Get-DotaState {
  if (([DateTime]::UtcNow - $S.lastGsiAt).TotalSeconds -le 15) { return 'connected' }
  if ($S.dotaRunning) { return 'waiting' }
  return 'not_running'
}

function Get-LiveSessionState {
  if (-not $Shared.Token) { return 'unpaired' }
  switch ([string]$Shared.Upstream) {
    'ok' { return 'connected' }
    'unauthorized' { return 'unauthorized' }
    'offline' { return 'offline' }
  }
  return 'connecting'
}

# ---------------------------------------------------------------- Dota cfg -----------------------------------
function Update-DotaFolders {
  $S.lastDiscovery = [DateTime]::UtcNow
  try { $S.cfgDirs = @(Find-AllDotaCfgFolders $false) } catch { $S.cfgDirs = @() }
}

function Set-Link($Remote) {
  if ($Remote.origin -ceq $Shared.Origin -and $Remote.liveId -ceq $Shared.LiveId -and $Remote.token -ceq $Shared.Token) { return }
  $Config.origin = $Remote.origin
  $Config.liveId = $Remote.liveId
  $Config.token = $Remote.token
  Write-CompanionConfig $Config
  $Shared.Origin = $Remote.origin
  $Shared.LiveId = $Remote.liveId
  $Shared.Token = $Remote.token
  $Shared.Upstream = 'connecting'
  $Shared.HeartbeatDirty = $true
  $Shared.LinkVersion = $Shared.LinkVersion + 1
  Write-Log 'paired with a new D2KIRO link (adopted from a downloaded cfg)'
}

# Keeps OUR cfg in every Dota folder. A D2KIRO cfg the site generated (a fresh "instalador para Windows"
# download) is not overwritten blindly: its link is adopted first, so re-pairing is just downloading it again.
function Sync-DotaCfg {
  $S.lastCfgSync = [DateTime]::UtcNow
  $local = Get-LocalCfg $Port $Config.localToken
  $installed = $false
  foreach ($cfgDir in $S.cfgDirs) {
    try {
      $dir = [IO.Path]::Combine($cfgDir, 'gamestate_integration')
      $file = [IO.Path]::Combine($dir, $CfgName)
      $current = $null
      if ([IO.File]::Exists($file) -and (New-Object IO.FileInfo($file)).Length -le 65536) { $current = [IO.File]::ReadAllText($file) }
      if ($current -ceq $local) {
        $installed = $true
        # Written (e.g. by the installer) after this Dota started, and Dota has not spoken yet: it needs one restart.
        $written = (New-Object IO.FileInfo($file)).LastWriteTimeUtc
        if ($S.dotaRunning -and $null -ne $S.dotaStart -and $S.lastGsiAt -eq [DateTime]::MinValue -and $written -gt $S.dotaStart) { $S.restartNeeded = $true; $S.cfgWrittenAt = $written }
        continue
      }
      if ($null -ne $current) { $remote = Read-RemoteLink $current; if ($null -ne $remote) { Set-Link $remote } }
      [void][IO.Directory]::CreateDirectory($dir)
      [IO.File]::WriteAllText($file, $local, (New-Object System.Text.UTF8Encoding($false)))
      $installed = $true
      $S.cfgWrittenAt = [DateTime]::UtcNow
      if ($S.dotaRunning) { $S.restartNeeded = $true }
      Write-Log 'Dota GSI cfg written'
    } catch { Write-Log ('Dota cfg sync failed: ' + $_.Exception.GetType().Name) }
  }
  $S.cfgInstalled = $installed
}

function Update-DotaProcess {
  $S.lastProcCheck = [DateTime]::UtcNow
  $process = Get-Process -Name 'dota2' -ErrorAction SilentlyContinue | Select-Object -First 1
  $running = $null -ne $process
  $start = $null
  if ($running) { try { $start = $process.StartTime.ToUniversalTime() } catch { $start = $null } }
  if ($running -ne $S.dotaRunning) { Write-Log ('dota2 running: ' + $running) }
  $S.dotaRunning = $running
  $S.dotaStart = $start
  # Dota reads cfgs at launch: a restart after our write (or Dota closed) clears the hint.
  if (-not $running) { $S.restartNeeded = $false }
  elseif ($S.restartNeeded -and $null -ne $start -and $null -ne $S.cfgWrittenAt -and $start -gt $S.cfgWrittenAt) { $S.restartNeeded = $false }
}

# ---------------------------------------------------------------- diagnostics --------------------------------
# Raw: every payload outside MATCH, one per 2 s inside MATCH (plus every key-set / state change); 16 MB files,
# 160 MB in total, oldest deleted first. The local token is removed before anything is written.
# Inventory: per phase, JSON paths (digits -> #) with counts and types -- never a value.
function Remove-OldDiagnostics {
  try {
    $files = @([IO.Directory]::GetFiles($DiagDir, 'gsi-raw-*.jsonl') | ForEach-Object { New-Object IO.FileInfo($_) } | Sort-Object LastWriteTimeUtc -Descending)
    $total = 0
    foreach ($file in $files) {
      $total += $file.Length
      if ($total -gt $RawMaxTotalBytes -and ($null -eq $D.writer -or $file.FullName -ne $D.file)) { try { $file.Delete() } catch { } }
    }
    $inventories = @([IO.Directory]::GetFiles($DiagDir, 'inventory-2*.json') | Sort-Object -Descending)
    for ($i = $InventoryKeep; $i -lt $inventories.Count; $i++) { try { [IO.File]::Delete($inventories[$i]) } catch { } }
  } catch { }
}

function Write-RawLine([string]$Line) {
  if ($null -ne $D.writer -and $D.writer.BaseStream.Length -gt $RawMaxFileBytes) { $D.writer.Dispose(); $D.writer = $null; $D.part = $D.part + 1 }
  if ($null -eq $D.writer) {
    [void][IO.Directory]::CreateDirectory($DiagDir)
    $D.file = [IO.Path]::Combine($DiagDir, ('gsi-raw-' + $D.runId + '-' + $D.part.ToString('000') + '.jsonl'))
    $D.writer = New-Object IO.StreamWriter($D.file, $true, (New-Object System.Text.UTF8Encoding($false)))
    $D.writer.AutoFlush = $true
    Remove-OldDiagnostics
  }
  $D.writer.WriteLine($Line)
}

function Get-ShapeKey([string]$Key) {
  $normalized = [regex]::Replace([regex]::Replace($Key, '[0-9]+', '#'), '[^A-Za-z0-9_#]', '?')
  if ($normalized.Length -gt 48) { $normalized = $normalized.Substring(0, 48) + '~' }
  return $normalized
}

function Add-Shape($Paths, [string]$Path, $Value, [int]$Depth) {
  if ($Paths.Count -ge 4000 -and -not $Paths.ContainsKey($Path)) { return }
  $type = 'null'
  $nonEmpty = $false
  if ($null -eq $Value) { }
  elseif ($Value -is [string]) { $type = 'string'; $nonEmpty = $Value.Length -gt 0 }
  elseif ($Value -is [bool]) { $type = 'bool'; $nonEmpty = $Value }
  elseif ($Value -is [Collections.IDictionary]) { $type = 'object'; $nonEmpty = $Value.Count -gt 0 }
  elseif ($Value -is [Array]) { $type = 'array'; $nonEmpty = $Value.Length -gt 0 }
  elseif ($Value -is [ValueType]) { $type = 'number'; $nonEmpty = [double]$Value -ne 0 }
  else { $type = 'other' }
  $entry = $Paths[$Path]
  if ($null -eq $entry) { $entry = @{ seen = 0; nonEmpty = 0; types = (New-Object 'System.Collections.Generic.HashSet[string]') }; $Paths[$Path] = $entry }
  $entry.seen = $entry.seen + 1
  if ($nonEmpty) { $entry.nonEmpty = $entry.nonEmpty + 1 }
  [void]$entry.types.Add($type)
  if ($Depth -ge 6) { return }
  if ($type -eq 'object') { foreach ($key in @($Value.Keys)) { Add-Shape $Paths ($Path + '.' + (Get-ShapeKey ([string]$key))) $Value[$key] ($Depth + 1) } }
  elseif ($type -eq 'array') {
    $count = 0
    foreach ($item in $Value) { if ($count -ge 3) { break }; Add-Shape $Paths ($Path + '[]') $item ($Depth + 1); $count++ }
  }
}

function Add-Inventory($Payload, [string]$Phase, $GameState, [DateTime]$Now) {
  $stats = $D.phases[$Phase]
  if ($null -eq $stats) { $stats = @{ posts = 0; firstAt = $Now; lastAt = $Now; gameStates = (New-Object 'System.Collections.Generic.HashSet[string]'); paths = @{} }; $D.phases[$Phase] = $stats }
  $stats.posts = $stats.posts + 1
  $stats.lastAt = $Now
  $state = 'NONE'
  if ($GameState) { $state = 'OTHER'; if ([string]$GameState -cmatch '^DOTA_GAMERULES_STATE_[A-Z_]{1,48}$') { $state = [string]$GameState } }
  [void]$stats.gameStates.Add($state)
  Add-Shape $stats.paths '$' $Payload 0
  $D.dirty = $true
}

function Save-Inventory {
  if (-not $D.dirty) { return }
  try {
    $doc = New-Doc
    Set-Field $doc 'schema' ('d2kiro-gsi-inventory/v1')
    Set-Field $doc 'note' ('Shapes and counts only: no value from any payload is stored here (key digits normalized to #).')
    Set-Field $doc 'companionVersion' ($CompanionVersion)
    Set-Field $doc 'runId' ($D.runId)
    Set-Field $doc 'updatedAt' ([DateTime]::UtcNow.ToString('o'))
    $phases = New-Doc
    foreach ($phase in @($D.phases.Keys | Sort-Object)) {
      $stats = $D.phases[$phase]
      $item = New-Doc
      Set-Field $item 'posts' ($stats.posts)
      Set-Field $item 'firstAt' ($stats.firstAt.ToString('o'))
      Set-Field $item 'lastAt' ($stats.lastAt.ToString('o'))
      $states = [string[]]@($stats.gameStates)
      [Array]::Sort($states)
      Set-Field $item 'gameStates' ($states)
      $paths = New-Doc
      foreach ($path in @($stats.paths.Keys | Sort-Object)) {
        $entry = $stats.paths[$path]
        $row = New-Doc
        Set-Field $row 'seen' ($entry.seen)
        Set-Field $row 'nonEmpty' ($entry.nonEmpty)
        $types = [string[]]@($entry.types)
        [Array]::Sort($types)
        Set-Field $row 'types' ($types)
        Set-Field $paths $path ($row)
      }
      Set-Field $item 'paths' ($paths)
      Set-Field $phases $phase ($item)
    }
    Set-Field $doc 'phases' ($phases)
    [void][IO.Directory]::CreateDirectory($DiagDir)
    $text = $Json.Serialize($doc)
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText([IO.Path]::Combine($DiagDir, ('inventory-' + $D.runId + '.json')), $text, $encoding)
    [IO.File]::WriteAllText([IO.Path]::Combine($DiagDir, 'inventory-latest.json'), $text, $encoding)
    $D.dirty = $false
    $D.savedAt = [DateTime]::UtcNow
  } catch { Write-Log ('inventory save failed: ' + $_.Exception.GetType().Name) }
}

function Add-Diagnostics($Payload, $GameState, [string]$Phase, [DateTime]$Now, [bool]$PhaseChanged) {
  try {
    $keys = [string[]]@($Payload.Keys)
    [Array]::Sort($keys)
    $keySet = [string]::Join(',', $keys)
    $state = [string]$GameState
    $sample = $Phase -ne 'MATCH' -or $PhaseChanged -or $keySet -ne $D.lastKeys -or $state -ne $D.lastGameState -or ($Now - $D.lastRecordAt).TotalMilliseconds -ge $MatchSampleMs
    $D.lastKeys = $keySet
    $D.lastGameState = $state
    if (-not $sample) { return }
    $D.lastRecordAt = $Now
    $D.seq = $D.seq + 1
    $line = New-Doc
    Set-Field $line 'seq' ($D.seq)
    Set-Field $line 'receivedAt' ($Now.ToString('o'))
    Set-Field $line 'gameState' ($GameState)
    Set-Field $line 'phase' ($Phase)
    Set-Field $line 'payload' ($Payload)
    Write-RawLine ($Json.Serialize($line))
    Add-Inventory $Payload $Phase $GameState $Now
  } catch { Write-Log ('diagnostics failed: ' + $_.Exception.GetType().Name) }
}

# ---------------------------------------------------------------- HTTP (127.0.0.1) ---------------------------
function Get-Reason([int]$Code) {
  switch ($Code) { 200 { return 'OK' } 204 { return 'No Content' } 400 { return 'Bad Request' } 401 { return 'Unauthorized' } 403 { return 'Forbidden' } 404 { return 'Not Found' } 409 { return 'Conflict' } 413 { return 'Payload Too Large' } 421 { return 'Misdirected Request' } 429 { return 'Too Many Requests' } 503 { return 'Service Unavailable' } }
  return 'Status'
}

function Send-Response($Client, [int]$Code, [string]$ContentType, [string]$Body, $Extra) {
  $bytes = [Text.Encoding]::UTF8.GetBytes([string]$Body)
  $head = 'HTTP/1.1 ' + $Code + ' ' + (Get-Reason $Code) + $CRLF + 'Content-Length: ' + $bytes.Length + $CRLF + 'Connection: close' + $CRLF + 'Cache-Control: no-store' + $CRLF + 'X-Content-Type-Options: nosniff' + $CRLF
  if ($ContentType) { $head = $head + 'Content-Type: ' + $ContentType + $CRLF }
  if ($null -ne $Extra) { foreach ($name in $Extra.Keys) { $head = $head + $name + ': ' + $Extra[$name] + $CRLF } }
  $head = $head + $CRLF
  $headBytes = $Latin1.GetBytes($head)
  $stream = $Client.GetStream()
  $stream.Write($headBytes, 0, $headBytes.Length)
  if ($bytes.Length -gt 0) { $stream.Write($bytes, 0, $bytes.Length) }
  $stream.Flush()
}

function ConvertFrom-Chunked([byte[]]$Raw) {
  $text = $Latin1.GetString($Raw)
  $out = New-Object IO.MemoryStream
  $position = 0
  while ($true) {
    $eol = $text.IndexOf($CRLF, $position, [StringComparison]::Ordinal)
    if ($eol -lt 0) { return $null }
    $size = 0
    if (-not [int]::TryParse($text.Substring($position, $eol - $position).Split(';')[0].Trim(), [Globalization.NumberStyles]::HexNumber, [Globalization.CultureInfo]::InvariantCulture, [ref]$size)) { return $null }
    if ($size -eq 0) { return ,$out.ToArray() }
    $start = $eol + 2
    if ($start + $size -gt $Raw.Length) { return $null }
    $out.Write($Raw, $start, $size)
    $position = $start + $size + 2
  }
}

# Minimal HTTP/1.1 request reader: Content-Length or chunked, 5 s socket timeouts, hard size caps.
function Read-Request($Client, [int]$MaxBody) {
  $Client.ReceiveTimeout = 5000
  $Client.SendTimeout = 5000
  $stream = $Client.GetStream()
  $buffer = New-Object byte[] 16384
  $acc = New-Object IO.MemoryStream
  $headerEnd = -1
  $text = ''
  while ($headerEnd -lt 0) {
    $n = $stream.Read($buffer, 0, $buffer.Length)
    if ($n -le 0) { return $null }
    $acc.Write($buffer, 0, $n)
    $text = $Latin1.GetString($acc.GetBuffer(), 0, [int]$acc.Length)
    $headerEnd = $text.IndexOf($HeaderTerminator, [StringComparison]::Ordinal)
    if ($headerEnd -lt 0 -and $acc.Length -gt 16384) { return $null }
  }
  $lines = $text.Substring(0, $headerEnd).Split([string[]]@($CRLF), [StringSplitOptions]::None)
  $first = $lines[0].Split(' ')
  if ($first.Length -lt 3) { return $null }
  $headers = @{}
  for ($i = 1; $i -lt $lines.Length; $i++) {
    $colon = $lines[$i].IndexOf(':')
    if ($colon -gt 0) { $headers[$lines[$i].Substring(0, $colon).Trim().ToLowerInvariant()] = $lines[$i].Substring($colon + 1).Trim() }
  }
  $request = @{ method = $first[0]; path = $first[1].Split('?')[0]; headers = $headers; bytes = $null; tooLarge = $false }
  $bodyStart = $headerEnd + 4
  $have = [int]$acc.Length - $bodyStart
  $body = New-Object IO.MemoryStream
  if ($have -gt 0) { $body.Write($acc.GetBuffer(), $bodyStart, $have) }
  if ([string]$headers['expect'] -match '100-continue' -and $have -le 0) {
    $continue = $Latin1.GetBytes('HTTP/1.1 100 Continue' + $CRLF + $CRLF)
    $stream.Write($continue, 0, $continue.Length)
  }
  if ([string]$headers['transfer-encoding'] -match 'chunked') {
    $terminator = '0' + $CRLF + $CRLF
    while (-not $Latin1.GetString($body.GetBuffer(), 0, [int]$body.Length).EndsWith($terminator)) {
      if ($body.Length -gt $MaxBody + 65536) { $request.tooLarge = $true; return $request }
      $n = $stream.Read($buffer, 0, $buffer.Length)
      if ($n -le 0) { return $null }
      $body.Write($buffer, 0, $n)
    }
    $request.bytes = ConvertFrom-Chunked $body.ToArray()
    if ($null -eq $request.bytes) { return $null }
    if ($request.bytes.Length -gt $MaxBody) { $request.tooLarge = $true }
    return $request
  }
  $length = 0
  if ($headers.ContainsKey('content-length') -and (-not [int]::TryParse([string]$headers['content-length'], [ref]$length) -or $length -lt 0)) { return $null }
  if ($length -gt $MaxBody) { $request.tooLarge = $true; return $request }
  while ($body.Length -lt $length) {
    $n = $stream.Read($buffer, 0, [Math]::Min($buffer.Length, $length - [int]$body.Length))
    if ($n -le 0) { return $null }
    $body.Write($buffer, 0, $n)
  }
  $all = $body.ToArray()
  if ($all.Length -gt $length) { $trimmed = New-Object byte[] $length; [Array]::Copy($all, $trimmed, $length); $all = $trimmed }
  $request.bytes = $all
  return $request
}

function Test-SameToken([string]$Candidate, [string]$Expected) {
  if ($null -eq $Candidate -or $null -eq $Expected -or $Candidate.Length -ne $Expected.Length -or $Expected.Length -eq 0) { return $false }
  $diff = 0
  for ($i = 0; $i -lt $Expected.Length; $i++) { $diff = $diff -bor ([int][char]$Candidate[$i] -bxor [int][char]$Expected[$i]) }
  return $diff -eq 0
}

function Read-JsonBody($Request) {
  try {
    $parsed = $Json.DeserializeObject([Text.Encoding]::UTF8.GetString($Request.bytes))
    if ($parsed -is [Collections.Generic.Dictionary[string,object]]) { return ,$parsed }
  } catch { }
  return $null
}

function Get-AuthToken($Payload) {
  $auth = $Payload['auth']
  if ($auth -isnot [Collections.IDictionary]) { return $null }
  $token = $auth['token']
  if ($token -is [string]) { return $token }
  return $null
}

function Invoke-Gsi($Client, $Request) {
  $payload = Read-JsonBody $Request
  if ($null -eq $payload) { Send-Response $Client 400 $null '' $null; return }
  if (-not (Test-SameToken (Get-AuthToken $payload) $Config.localToken)) { Send-Response $Client 401 $null '' $null; return }
  # Answer Dota first: forwarding and diagnostics never slow the game's own requests down.
  Send-Response $Client 200 'text/plain' 'ok' $null
  [void]$payload.Remove('auth')
  $now = [DateTime]::UtcNow
  $gameState = $null
  $map = $payload['map']
  if ($map -is [Collections.IDictionary] -and $map['game_state'] -is [string]) { $gameState = $map['game_state'] }
  $phase = Get-Phase $gameState
  $phaseChanged = $phase -ne $S.phase
  $S.lastGsiAt = $now
  $S.phase = $phase
  $S.gameState = $gameState
  $S.restartNeeded = $false
  $forward = New-Doc
  foreach ($section in $ForwardSections) { if ($payload.ContainsKey($section)) { Set-Field $forward $section ($payload[$section]) } }
  $Shared.Payload = $Json.Serialize($forward)
  $Shared.Seq = $Shared.Seq + 1
  Add-Diagnostics $payload $gameState $phase $now $phaseChanged
  if ($phaseChanged) { Write-Log ('phase ' + $phase); Save-Inventory }
}

function Get-HealthJson {
  $dota = Get-DotaState
  $doc = New-Doc
  Set-Field $doc 'schema' ('d2kiro-companion-health/v1')
  Set-Field $doc 'version' ($CompanionVersion)
  Set-Field $doc 'paired' ([bool]$Shared.Token)
  Set-Field $doc 'dota' ($dota)
  Set-Field $doc 'phase' ($null)
  if ($dota -eq 'connected') { Set-Field $doc 'phase' ($S.phase) }
  Set-Field $doc 'restartNeeded' ([bool]$S.restartNeeded)
  Set-Field $doc 'liveSession' (Get-LiveSessionState)
  Set-Field $doc 'cfgInstalled' ([bool]$S.cfgInstalled)
  Set-Field $doc 'heartbeat' ([bool]$Shared.HeartbeatSupported)
  Set-Field $doc 'visual' ([string]$V.state)
  Set-Field $doc 'lastGsiAgeMs' ($null)
  if ($S.lastGsiAt -ne [DateTime]::MinValue) { Set-Field $doc 'lastGsiAgeMs' ([int64]([DateTime]::UtcNow - $S.lastGsiAt).TotalMilliseconds) }
  return $Json.Serialize($doc)
}

function Invoke-Health($Client, $Request) {
  $origin = [string]$Request.headers['origin']
  $allowed = $origin -and $Shared.Origin -and $origin -ceq $Shared.Origin
  $headers = @{ 'Vary' = 'Origin' }
  if ($allowed) { $headers['Access-Control-Allow-Origin'] = $origin }
  if ($Request.method -eq 'OPTIONS') {
    if (-not $allowed) { Send-Response $Client 403 $null '' $headers; return }
    $headers['Access-Control-Allow-Methods'] = 'GET'
    $headers['Access-Control-Allow-Private-Network'] = 'true'
    $headers['Access-Control-Max-Age'] = '600'
    Send-Response $Client 204 $null '' $headers
    return
  }
  if ($Request.method -ne 'GET') { Send-Response $Client 404 $null '' $headers; return }
  Send-Response $Client 200 'application/json' (Get-HealthJson) $headers
}

# The local visual helper: same local token as Dota's cfg; the Companion adds the link token it alone holds.
function Invoke-VisualRelay($Client, $Request) {
  if ($Request.tooLarge) { Send-Response $Client 413 $null '' $null; return }
  $payload = Read-JsonBody $Request
  if ($null -eq $payload) { Send-Response $Client 400 $null '' $null; return }
  if (-not (Test-SameToken (Get-AuthToken $payload) $Config.localToken)) { Send-Response $Client 401 $null '' $null; return }
  if (-not $Shared.Token) { Send-Response $Client 503 $null '' $null; return }
  $auth = New-Doc
  Set-Field $auth 'token' ($Shared.Token)
  Set-Field $payload 'auth' ($auth)
  $base = $Shared.Origin
  if ($Shared.TestUpstream) { $base = $Shared.TestUpstream }
  $result = Send-Upstream ($base + '/api/live/visual/' + $Shared.LiveId) ($Json.Serialize($payload)) 4000 $CompanionVersion
  if ($result.code -eq 0) { Send-Response $Client 503 $null '' $null; return }
  Send-Response $Client $result.code 'application/json' $result.body $null
}

# DNS rebinding defense: a page on another site that resolves its own name to 127.0.0.1 always sends ITS name.
# Loopback names only, port optional (HTTP clients may omit it); no Host at all (HTTP/1.0) is not a browser.
function Test-LocalHost([string]$HostHeader) {
  if (-not $HostHeader) { return $true }
  return $HostHeader -match ('^(127\.0\.0\.1|localhost)(:' + $Port + ')?$')
}

function Invoke-Client($Client) {
  try {
    $request = Read-Request $Client 2097152
    if ($null -eq $request) { return }
    if (-not (Test-LocalHost ([string]$request.headers['host']))) { Send-Response $Client 421 $null '' $null; return }
    $path = $request.path
    if ($request.method -eq 'POST' -and ($path -eq '/gsi' -or $path -eq '/gsi/')) {
      if ($request.tooLarge) { Send-Response $Client 413 $null '' $null; return }
      Invoke-Gsi $Client $request
      return
    }
    if ($path -eq '/health') { Invoke-Health $Client $request; return }
    if ($request.method -eq 'POST' -and $path -cmatch '^/relay/api/live/visual/[A-Za-z0-9_-]{1,64}$') {
      if ($null -ne $request.bytes -and $request.bytes.Length -gt $RelayMaxBytes) { $request.tooLarge = $true }
      Invoke-VisualRelay $Client $request
      return
    }
    Send-Response $Client 404 $null '' $null
  } catch {
    Write-Log ('request failed: ' + $_.Exception.GetType().Name + ' at line ' + $_.InvocationInfo.ScriptLineNumber)
  } finally {
    try { $Client.Close() } catch { }
  }
}

${VISUAL_SUPERVISOR_PS}
# ---------------------------------------------------------------- periodic -----------------------------------
function Invoke-Periodic {
  $now = [DateTime]::UtcNow
  if (($now - $S.lastProcCheck).TotalSeconds -ge 5) { Update-DotaProcess }
  if (($S.cfgDirs.Count -eq 0 -and ($now - $S.lastDiscovery).TotalMinutes -ge 2) -or ($now - $S.lastDiscovery).TotalMinutes -ge 30) { Update-DotaFolders; Sync-DotaCfg }
  if (($now - $S.lastCfgSync).TotalSeconds -ge $CfgSyncSeconds) { Sync-DotaCfg }
  if ($D.dirty -and ($now - $D.savedAt).TotalSeconds -ge 60) { Save-Inventory }
  if (($now - $V.lastCheck).TotalSeconds -ge 2) { Update-Visual }
  $dota = Get-DotaState
  $phase = $null
  if ($dota -eq 'connected') { $phase = $S.phase }
  if ($dota -ne $S.lastDota -or [string]$phase -ne $S.lastPhase) { $S.lastDota = $dota; $S.lastPhase = [string]$phase; $Shared.HeartbeatDirty = $true }
  $Shared.HbDota = $dota
  $Shared.HbPhase = $phase
  $Shared.HbRestart = [bool]$S.restartNeeded
  if ([string]$V.state -ne $S.lastVisual) { $S.lastVisual = [string]$V.state; $Shared.HeartbeatDirty = $true }
  $Shared.HbVisual = [string]$V.state
  if ($null -ne $Worker -and $Worker.handle.IsCompleted) { Write-Log 'upstream worker stopped: restarting'; try { $Worker.shell.Dispose() } catch { }; Start-Worker }
}

Write-Log ('started ' + $CompanionVersion + ' on 127.0.0.1:' + $Port + ' paired=' + [bool]$Config.token)
Update-DotaProcess
Update-DotaFolders
Sync-DotaCfg
Start-Worker
Stop-VisualProcesses
while ($true) {
  try {
    if ($Listener.Pending()) { Invoke-Client ($Listener.AcceptTcpClient()); continue }
    Invoke-Periodic
    Start-Sleep -Milliseconds 25
  } catch {
    Write-Log ('loop error: ' + $_.Exception.GetType().Name + ' at line ' + $_.InvocationInfo.ScriptLineNumber)
    Start-Sleep -Milliseconds 500
  }
}
`;

/** The installer's own script (#D2KIRO-SCRIPT block): pair, install, register, start. */
export const COMPANION_INSTALL_PS = String.raw`#D2KIRO-SCRIPT-BEGIN
# D2KIRO Companion -- instalador. Que hace:
#   copia el Companion a %LOCALAPPDATA%\D2KIRO\Companion, lo registra para arrancar con Windows (solo tu usuario,
#   sin permisos de administrador), deja ${GSI_CFG_FILENAME} en Dota 2 apuntando a esta PC y lo arranca.
# Que NO hace: no lee tu cuenta de Steam, no toca otros archivos de Dota ni de Steam, no muestra tu conexion.
$ErrorActionPreference = 'Stop'
${COMMON_PS}
${DOTA_DISCOVERY_PS}

function Read-Block([string]$Name) {
  $self = [IO.File]::ReadAllText($env:D2KIRO_SELF)
  $begin = '#D2KIRO-' + $Name + '-BEGIN'
  $end = '#D2KIRO-' + $Name + '-END'
  $i = $self.IndexOf($begin, [StringComparison]::Ordinal)
  $j = $self.IndexOf($end, [StringComparison]::Ordinal)
  if ($i -lt 0 -or $j -le $i) { return $null }
  return $self.Substring($i + $begin.Length, $j - $i - $begin.Length).Trim()
}

# The batch preamble (lib/gsi-windows-installer batchHeader) sets D2KIRO_MODE.
if ($env:D2KIRO_MODE -ne 'install') { exit 4 }

$Runtime = $null
try { $Runtime = Read-Block 'RUNTIME' } catch { $Runtime = $null }
if ($null -eq $Runtime -or $Runtime.Length -lt 1000) { Show-Result ('Este instalador está incompleto o fue modificado.' + $NL + $NL + 'Descarga uno nuevo desde la página de D2KIRO. No se cambió nada.') $false; exit 4 }

# Pairing, freshest first: the link inside this download, then a D2KIRO cfg the site generated that is
# installed in Dota (e.g. «Descargar instalador para Windows»), then the Companion's previous pairing.
$Link = $null
$Embedded = $null
try { $Embedded = Read-Block 'CFG' } catch { $Embedded = $null }
if ($null -ne $Embedded) {
  $Link = Read-RemoteLink $Embedded
  if ($null -eq $Link) { Show-Result ('Este instalador está incompleto o fue modificado.' + $NL + $NL + 'Descarga uno nuevo desde la página de D2KIRO. No se cambió nada.') $false; exit 4 }
}

$Folders = Find-AllDotaCfgFolders $false
if ($Folders.Count -eq 0) { Show-Result ('No encontramos Dota 2 en esta PC.' + $NL + $NL + 'Buscamos en todas tus bibliotecas de Steam (C:, D: y las demás). No se cambió nada.') $false; exit 2 }

if ($null -eq $Link) {
  foreach ($cfgDir in $Folders) {
    $file = [IO.Path]::Combine([IO.Path]::Combine($cfgDir, 'gamestate_integration'), $CfgName)
    if (-not [IO.File]::Exists($file) -or (New-Object IO.FileInfo($file)).Length -gt 65536) { continue }
    $Link = Read-RemoteLink ([IO.File]::ReadAllText($file))
    if ($null -ne $Link) { break }
  }
}
$Previous = Read-CompanionConfig
if ($null -eq $Link -and $null -ne $Previous -and $Previous.token) { $Link = @{ origin = $Previous.origin; liveId = $Previous.liveId; token = $Previous.token } }
if ($null -eq $Link) {
  Show-Result ('No encontramos tu conexión con D2KIRO en esta PC.' + $NL + $NL + 'Abre D2KIRO, entra a «Draft en vivo» y descarga «Instalar D2KIRO Companion». Después abre ese archivo. No se cambió nada.') $false
  exit 5
}

$LocalToken = New-HexToken
$Port = $DefaultPort
if ($env:D2KIRO_COMPANION_PORT -match '^[0-9]{4,5}$') { $Port = [int]$env:D2KIRO_COMPANION_PORT }
if ($null -ne $Previous) { $LocalToken = $Previous.localToken; $Port = $Previous.port }

try {
  Stop-OtherCompanions
  [void][IO.Directory]::CreateDirectory($AppDir)
  # BOM: Windows PowerShell 5.1 reads a .ps1 without one in the ANSI code page.
  [IO.File]::WriteAllText($RuntimePath, $Runtime + $NL, (New-Object System.Text.UTF8Encoding($true)))
  Write-CompanionConfig @{ origin = $Link.origin; liveId = $Link.liveId; token = $Link.token; localToken = $LocalToken; port = $Port }
  $uninstall = '@echo off' + $CRLF + 'set "D2KIRO_COMPANION_MODE=uninstall"' + $CRLF + '"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0companion.ps1"' + $CRLF + '(goto) 2>nul & del "%~f0"' + $CRLF
  [IO.File]::WriteAllText($UninstallCmdPath, $uninstall, (New-Object System.Text.ASCIIEncoding))
  $LocalCfg = Get-LocalCfg $Port $LocalToken
  foreach ($cfgDir in $Folders) {
    $dir = [IO.Path]::Combine($cfgDir, 'gamestate_integration')
    [void][IO.Directory]::CreateDirectory($dir)
    [IO.File]::WriteAllText([IO.Path]::Combine($dir, $CfgName), $LocalCfg, (New-Object System.Text.UTF8Encoding($false)))
  }
} catch {
  Show-Result ('No pudimos instalar D2KIRO Companion.' + $NL + $NL + 'Cierra Dota 2 e inténtalo de nuevo.') $false
  exit 3
}

$Launch = Get-LaunchCommand
if (-not $NoAutostart) {
  try {
    New-Item -Path $RunKey -Force | Out-Null
    Set-ItemProperty -Path $RunKey -Name $RunValue -Value ('"' + $Launch.file + '" ' + $Launch.arguments)
    New-Item -Path $UninstallKey -Force | Out-Null
    Set-ItemProperty -Path $UninstallKey -Name 'DisplayName' -Value 'D2KIRO Companion'
    Set-ItemProperty -Path $UninstallKey -Name 'DisplayVersion' -Value $CompanionVersion
    Set-ItemProperty -Path $UninstallKey -Name 'Publisher' -Value 'D2KIRO'
    Set-ItemProperty -Path $UninstallKey -Name 'InstallLocation' -Value $AppDir
    Set-ItemProperty -Path $UninstallKey -Name 'UninstallString' -Value ('"' + $UninstallCmdPath + '"')
    Set-ItemProperty -Path $UninstallKey -Name 'NoModify' -Value 1 -Type DWord
    Set-ItemProperty -Path $UninstallKey -Name 'NoRepair' -Value 1 -Type DWord
  } catch {
    Show-Result ('D2KIRO Companion quedó instalado, pero no pudimos hacer que arranque solo con Windows.' + $NL + $NL + 'Vuelve a abrir este instalador.') $false
    exit 3
  }
}

$Running = $false
if ($env:D2KIRO_TEST_NO_START -ne '1') {
  Start-Process -FilePath $Launch.file -ArgumentList $Launch.arguments -WindowStyle Hidden
  for ($i = 0; $i -lt 20 -and -not $Running; $i++) {
    Start-Sleep -Milliseconds 500
    try {
      $probe = [Net.WebRequest]::Create('http://127.0.0.1:' + $Port + '/health')
      $probe.Timeout = 1000
      $answer = $probe.GetResponse()
      $Running = ([int]$answer.StatusCode) -eq 200
      $answer.Close()
    } catch { $Running = $false }
    if (-not $Running) { $current = Read-CompanionConfig; if ($null -ne $current) { $Port = $current.port } }
  }
}

$restart = ''
if (Get-Process -Name 'dota2' -ErrorAction SilentlyContinue) { $restart = $NL + $NL + 'Dota 2 está abierto: ciérralo y vuelve a abrirlo (solo esta vez).' }
$launchHint = 'Si Dota nunca aparece como conectado: en Steam, clic derecho en Dota 2 > Propiedades > General > Opciones de lanzamiento, agrega -gamestateintegration.'
$state = 'D2KIRO Companion quedó instalado y corriendo en segundo plano.'
if ($env:D2KIRO_TEST_NO_START -eq '1') { $state = 'D2KIRO Companion quedó instalado.' }
elseif (-not $Running) { $state = 'D2KIRO Companion quedó instalado; arranca solo la próxima vez que inicies sesión en Windows.' }
Show-Result ('Listo: ' + $state + $NL + $NL + 'Desde ahora arranca solo con Windows: no hace falta abrir nada más. Abre D2KIRO en el navegador y juega normal.' + $restart + $NL + $NL + $launchHint + $NL + $NL + 'Para desinstalarlo: Configuración de Windows > Aplicaciones > D2KIRO Companion.') $true
exit 0
#D2KIRO-SCRIPT-END`;
