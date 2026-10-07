// D2KIRO Visual runtime as the Companion sees it: WHICH build to fetch (pinned) and the PowerShell that fetches,
// verifies, starts, supervises and removes it. Pure strings, no I/O -- SERVER-ONLY like companion-scripts.ts
// (the 127.0.0.1 / github.com literals belong to a file the Player runs on their own PC, not to browser code).
//
// Supply chain: the Companion downloads EXACTLY `url` and keeps it only if its SHA-256 equals `sha256`. The pin lives
// in this repo (reviewed), so a tampered or swapped release asset is refused, never executed. A new runtime is a new
// release tag (visual-runtime-v<version>, built by .github/workflows/visual-runtime.yml) plus a reviewed edit here.
//
// Written without backticks and without "${" in the generated PowerShell so it can live in a JS raw template.

export const VISUAL_RUNTIME = {
  version: "0.1.1",
  /** SHA-256 of the release zip (hex, lowercase). Updated together with `version`. */
  sha256: "300759174824a7a284de43ed00a03e3e34d75c4322198c02426cf3f7978e72fd",
  /** Release assets of this public repository; the only host the Companion fetches the runtime from in production. */
  url: "https://github.com/apuherrerafo/D2KIRO/releases/download/visual-runtime-v0.1.1/d2kiro-visual-0.1.1.zip",
  exeName: "d2kiro-visual.exe",
} as const;

/** What the Companion reports about the helper (health endpoint, and later the heartbeat). Closed vocabulary. */
export const VISUAL_STATES = ["absent", "downloading", "failed", "restarting", "running"] as const;
export type VisualState = (typeof VISUAL_STATES)[number];

/** Runs in a background runspace: download -> size cap -> SHA-256 -> safe extract -> atomic move. Never in the main loop. */
const VISUAL_FETCH_BODY = String.raw`
$ErrorActionPreference = 'Stop'
$Cap = 419430400
$zip = $null
$stage = $null
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  [void][IO.Directory]::CreateDirectory($VisualRoot)
  $zip = [IO.Path]::Combine($VisualRoot, 'download-' + [Guid]::NewGuid().ToString('N') + '.zip')
  $stage = [IO.Path]::Combine($VisualRoot, 'stage-' + [Guid]::NewGuid().ToString('N'))
  $request = [Net.HttpWebRequest]::Create($VisualUrl)
  $request.Timeout = 30000
  $request.ReadWriteTimeout = 30000
  $request.UserAgent = 'D2KIRO-Companion'
  $response = $request.GetResponse()
  try {
    if ($response.ContentLength -gt $Cap) { throw 'too_large' }
    $in = $response.GetResponseStream()
    $out = [IO.File]::Create($zip)
    try {
      $buffer = New-Object byte[] 81920
      $total = 0
      while (($read = $in.Read($buffer, 0, $buffer.Length)) -gt 0) {
        $out.Write($buffer, 0, $read)
        $total += $read
        if ($total -gt $Cap) { throw 'too_large' }
      }
    } finally { $out.Dispose(); $in.Dispose() }
  } finally { $response.Close() }
  $stream = [IO.File]::OpenRead($zip)
  try { $hex = ([BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($stream))).Replace('-', '').ToLowerInvariant() } finally { $stream.Dispose() }
  if ($hex -cne $VisualSha.ToLowerInvariant()) { throw 'hash_mismatch' }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [void][IO.Directory]::CreateDirectory($stage)
  $stageFull = [IO.Path]::GetFullPath($stage) + [string][IO.Path]::DirectorySeparatorChar
  $archive = [IO.Compression.ZipFile]::OpenRead($zip)
  try {
    foreach ($entry in $archive.Entries) {
      if ($entry.FullName.EndsWith('/')) { continue }
      $target = [IO.Path]::GetFullPath([IO.Path]::Combine($stage, $entry.FullName))
      if (-not $target.StartsWith($stageFull, [StringComparison]::OrdinalIgnoreCase)) { throw 'bad_entry' }
      [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target))
      [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $true)
    }
  } finally { $archive.Dispose() }
  if (-not [IO.File]::Exists([IO.Path]::Combine($stage, $VisualExeName))) { throw 'no_exe' }
  if ([IO.Directory]::Exists($VisualDir)) { [IO.Directory]::Delete($VisualDir, $true) }
  [IO.Directory]::Move($stage, $VisualDir)
  $stage = $null
  foreach ($old in [IO.Directory]::GetDirectories($VisualRoot)) {
    if ($old -ne $VisualDir) { try { [IO.Directory]::Delete($old, $true) } catch { } }
  }
  $Shared.VisualFetch = 'ready'
} catch {
  $message = [string]$_.Exception.Message
  $code = 'error'
  foreach ($known in @('too_large', 'hash_mismatch', 'bad_entry', 'no_exe')) { if ($message -eq $known) { $code = $known } }
  if ($code -eq 'error') { $code = $_.Exception.GetType().Name }
  $Shared.VisualFetchError = $code
  $Shared.VisualFetch = 'failed'
} finally {
  if ($zip) { try { [IO.File]::Delete($zip) } catch { } }
  if ($stage) { try { if ([IO.Directory]::Exists($stage)) { [IO.Directory]::Delete($stage, $true) } } catch { } }
}
`;

/** The supervisor spliced into the Companion runtime (needs $AppDir, $Shared, $S, $Port, Write-Log, Show of cfgDirs). */
export const VISUAL_SUPERVISOR_PS = String.raw`
# ---------------------------------------------------------------- D2KIRO Visual (supervised) ------------------
# A small helper (d2kiro-visual.exe) reads the hero portraits of Dota's OWN window and sends only derived facts
# (hero ids) through this Companion's local relay. The Companion fetches it once from the pinned release (SHA-256
# checked), starts it hidden, restarts it if it dies, and removes it on uninstall. Frames never leave the PC.
$VisualVersion = $env:D2KIRO_TEST_VISUAL_VERSION
if (-not $VisualVersion) { $VisualVersion = '${VISUAL_RUNTIME.version}' }
# Test-only, same convention as D2KIRO_TEST_UPSTREAM. URL and SHA256 overrides together would defeat the pin: they must
# never be wired to anything persisted or remote.
$VisualUrl = $env:D2KIRO_TEST_VISUAL_URL
if (-not $VisualUrl) { $VisualUrl = '${VISUAL_RUNTIME.url}' }
$VisualSha = $env:D2KIRO_TEST_VISUAL_SHA256
if (-not $VisualSha) { $VisualSha = '${VISUAL_RUNTIME.sha256}' }
$VisualExeName = '${VISUAL_RUNTIME.exeName}'
$VisualRoot = [IO.Path]::Combine($AppDir, 'visual')
$VisualDir = [IO.Path]::Combine($VisualRoot, $VisualVersion)
$VisualExe = [IO.Path]::Combine($VisualDir, $VisualExeName)
$VisualOff = $env:D2KIRO_TEST_NO_VISUAL -eq '1'
$VisualRestartSteps = @(2, 5, 15, 30, 60)
if ($env:D2KIRO_TEST_VISUAL_RESTART_SECONDS) { $VisualRestartSteps = @([double]$env:D2KIRO_TEST_VISUAL_RESTART_SECONDS) }
$VisualFetchSteps = @(60, 300, 900, 3600)
if ($env:D2KIRO_TEST_VISUAL_FETCH_RETRY_SECONDS) { $VisualFetchSteps = @([double]$env:D2KIRO_TEST_VISUAL_FETCH_RETRY_SECONDS) }
$VisualFetchCode = {${VISUAL_FETCH_BODY}}.ToString()
$Shared.VisualFetch = 'idle'
$Shared.VisualFetchError = ''
$V = @{ proc = $null; startedAt = [DateTime]::MinValue; crashes = 0; nextStart = [DateTime]::MinValue; fetchWorker = $null; fetchFailures = 0; nextFetch = [DateTime]::MinValue; state = 'absent'; lastCheck = [DateTime]::MinValue }

function Get-VisualStep($Steps, [int]$Count) {
  $index = [Math]::Max(0, [Math]::Min($Count - 1, $Steps.Count - 1))
  return [double]$Steps[$index]
}

# Every d2kiro-visual.exe that lives under OUR visual folder (a leftover from a previous Companion run, or an old version).
function Stop-VisualProcesses {
  foreach ($process in (Get-Process -Name 'd2kiro-visual' -ErrorAction SilentlyContinue)) {
    try {
      $path = [string]$process.Path
      if ($path -and $path.StartsWith($VisualRoot, [StringComparison]::OrdinalIgnoreCase)) { Stop-Process -Id $process.Id -Force -ErrorAction Stop }
    } catch { }
  }
}

function Get-VisualCfgFile {
  foreach ($cfgDir in $S.cfgDirs) {
    $file = [IO.Path]::Combine([IO.Path]::Combine($cfgDir, 'gamestate_integration'), $CfgName)
    if ([IO.File]::Exists($file)) { return $file }
  }
  return $null
}

function Start-VisualFetch {
  $Shared.VisualFetch = 'running'
  $runspace = [RunspaceFactory]::CreateRunspace()
  $runspace.Open()
  foreach ($name in @('Shared', 'VisualRoot', 'VisualDir', 'VisualUrl', 'VisualSha', 'VisualExeName')) { $runspace.SessionStateProxy.SetVariable($name, (Get-Variable -Name $name -ValueOnly)) }
  $shell = [PowerShell]::Create()
  $shell.Runspace = $runspace
  [void]$shell.AddScript($VisualFetchCode)
  $V.fetchWorker = @{ shell = $shell; handle = $shell.BeginInvoke() }
  Write-Log ('visual runtime ' + $VisualVersion + ': downloading')
}

function Close-VisualFetch {
  if ($null -eq $V.fetchWorker) { return }
  try { $V.fetchWorker.shell.Dispose() } catch { }
  $V.fetchWorker = $null
}

function Start-VisualProcess {
  $info = New-Object System.Diagnostics.ProcessStartInfo
  $info.FileName = $VisualExe
  $info.WorkingDirectory = $VisualDir
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  # Which Dota cfg to read the LOCAL relay credentials from: ours. The link token never reaches this process.
  $cfg = Get-VisualCfgFile
  if ($cfg) { $info.EnvironmentVariables['D2KIRO_GSI_CFG'] = $cfg }
  $V.proc = [System.Diagnostics.Process]::Start($info)
  $V.startedAt = [DateTime]::UtcNow
  Write-Log ('visual runtime ' + $VisualVersion + ' started')
}

# Called every couple of seconds from the main loop. Never blocks: the download runs in its own runspace.
function Update-Visual {
  $now = [DateTime]::UtcNow
  $V.lastCheck = $now
  if ($VisualOff) { $V.state = 'absent'; return }
  if (-not [IO.File]::Exists($VisualExe)) {
    if ($null -ne $V.fetchWorker) {
      if (-not $V.fetchWorker.handle.IsCompleted) { $V.state = 'downloading'; return }
      Close-VisualFetch
      if (-not [IO.File]::Exists($VisualExe)) {
        $V.fetchFailures++
        $V.nextFetch = $now.AddSeconds((Get-VisualStep $VisualFetchSteps $V.fetchFailures))
        Write-Log ('visual runtime download failed: ' + [string]$Shared.VisualFetchError)
      }
    }
    if ([IO.File]::Exists($VisualExe)) { return }
    if ($now -ge $V.nextFetch) { Start-VisualFetch; $V.state = 'downloading' } else { $V.state = 'failed' }
    return
  }
  Close-VisualFetch
  $V.fetchFailures = 0
  if ($null -ne $V.proc) {
    if (-not $V.proc.HasExited) {
      $V.state = 'running'
      if (($now - $V.startedAt).TotalSeconds -ge 120) { $V.crashes = 0 }
      return
    }
    Write-Log ('visual runtime exited (code ' + $V.proc.ExitCode + ')')
    $ranFor = ($now - $V.startedAt).TotalSeconds
    $V.proc = $null
    if ($ranFor -lt 120) { $V.crashes++ } else { $V.crashes = 1 }
    $V.nextStart = $now.AddSeconds((Get-VisualStep $VisualRestartSteps $V.crashes))
  }
  if ($now -lt $V.nextStart) { $V.state = 'restarting'; return }
  try { Start-VisualProcess; $V.state = 'running' } catch {
    $V.crashes++
    $V.nextStart = $now.AddSeconds((Get-VisualStep $VisualRestartSteps $V.crashes))
    $V.state = 'restarting'
    Write-Log ('visual runtime could not start: ' + $_.Exception.GetType().Name)
  }
}
`;
