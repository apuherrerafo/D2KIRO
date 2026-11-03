# Installs the LOCAL release candidate "visual 0.1.3-rc2" on THIS PC only. No tag, no staging pin, nothing deployed.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\live\rc\install-rc2.ps1
#
# Needs (built beforehand, gitignored):  out\companion.ps1  (bun scripts/live/rc/build-rc2.ts)
#                                        out\visual\dist\d2kiro-visual\  (python build_runtime.py --version 0.1.3-rc2 --out ../rc/out/visual)
# Keeps the Companion's pairing (config.json, DPAPI) and its autostart entry as they are. Backs the current runtime up
# once as companion.ps1.pre-rc2 (rollback-rc2.ps1 restores it). Refuses to run while Dota 2 is open.
$ErrorActionPreference = 'Stop'
$RcVersion = '0.1.3-rc2'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$App = Join-Path $env:LOCALAPPDATA 'D2KIRO\Companion'
$Runtime = Join-Path $App 'companion.ps1'
$Backup = Join-Path $App 'companion.ps1.pre-rc2'
$RcRuntime = Join-Path $Here 'out\companion.ps1'
$RcVisual = Join-Path $Here 'out\visual\dist\d2kiro-visual'
$VisualTarget = Join-Path $App ('visual\' + $RcVersion)

function Fail([string]$Message) { Write-Host ('RC2 INSTALL: NOT DONE -- ' + $Message); exit 2 }

if (-not (Test-Path (Join-Path $App 'config.json'))) { Fail 'no paired Companion on this PC (install it from the site first)' }
if (-not (Test-Path $RcRuntime)) { Fail 'out\companion.ps1 missing: run bun scripts/live/rc/build-rc2.ts' }
if (-not (Test-Path (Join-Path $RcVisual 'd2kiro-visual.exe'))) { Fail 'RC visual build missing: run build_runtime.py --version 0.1.3-rc2 --out ../rc/out/visual' }
$manifest = Get-Content -Raw (Join-Path $RcVisual 'manifest.json') | ConvertFrom-Json
if ($manifest.version -ne $RcVersion) { Fail ('RC visual build is ' + $manifest.version + ', expected ' + $RcVersion) }
if (-not ((Get-Content -Raw $RcRuntime).Contains("VisualVersion = '" + $RcVersion + "'"))) { Fail 'out\companion.ps1 is not the RC runtime' }
if (Get-Process -Name 'dota2' -ErrorAction SilentlyContinue) { Fail 'Dota 2 is running: close it first (the Companion restarts)' }

# Stop the running Companion (only ours) and the helper it supervises.
foreach ($p in (Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'")) {
  if ([string]$p.CommandLine -and ([string]$p.CommandLine).IndexOf($Runtime, [StringComparison]::OrdinalIgnoreCase) -ge 0) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
}
foreach ($p in (Get-Process -Name 'd2kiro-visual' -ErrorAction SilentlyContinue)) {
  if ([string]$p.Path -and ([string]$p.Path).StartsWith((Join-Path $App 'visual'), [StringComparison]::OrdinalIgnoreCase)) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
}
Start-Sleep -Seconds 2

if (-not (Test-Path $Backup)) { Copy-Item -LiteralPath $Runtime -Destination $Backup }
if (Test-Path $VisualTarget) { Remove-Item -LiteralPath $VisualTarget -Recurse -Force }
Copy-Item -LiteralPath $RcVisual -Destination $VisualTarget -Recurse
Copy-Item -LiteralPath $RcRuntime -Destination $Runtime -Force

# Start it exactly as Windows does at logon (the autostart entry the installer registered).
$run = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -ErrorAction SilentlyContinue).'D2KIRO Companion'
if ($run -and $run -match '^"([^"]+)"\s+(.*)$') { Start-Process -FilePath $Matches[1] -ArgumentList $Matches[2] -WindowStyle Hidden }
else { Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -ArgumentList ('-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $Runtime + '"') -WindowStyle Hidden }

$port = (Get-Content -Raw (Join-Path $App 'config.json') | ConvertFrom-Json).port
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 750
  try {
    $health = Invoke-RestMethod -Uri ('http://127.0.0.1:' + $port + '/health') -TimeoutSec 3
    if ($health.visual -eq 'running') { Write-Host ('RC2 INSTALL: DONE -- Companion ' + $health.version + ' paired=' + $health.paired + ' visual=' + $health.visual + ' (' + $RcVersion + ')'); exit 0 }
  } catch { }
}
Write-Host 'RC2 INSTALL: Companion restarted but the RC helper is not running yet -- run rc2_preflight.py'
exit 1
