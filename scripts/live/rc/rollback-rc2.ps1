# Puts THIS PC back on the Companion it had before install-rc2.ps1 (the site's build, visual 0.1.2). Local only.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\live\rc\rollback-rc2.ps1
#
# Local evidence (Companion\diagnostics, Visual\, Evidence\) is never touched.
$ErrorActionPreference = 'Stop'
$App = Join-Path $env:LOCALAPPDATA 'D2KIRO\Companion'
$Runtime = Join-Path $App 'companion.ps1'
$Backup = Join-Path $App 'companion.ps1.pre-rc2'
if (-not (Test-Path $Backup)) { Write-Host 'ROLLBACK: nothing to roll back (no companion.ps1.pre-rc2)'; exit 2 }

foreach ($p in (Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'")) {
  if ([string]$p.CommandLine -and ([string]$p.CommandLine).IndexOf($Runtime, [StringComparison]::OrdinalIgnoreCase) -ge 0) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
}
foreach ($p in (Get-Process -Name 'd2kiro-visual' -ErrorAction SilentlyContinue)) {
  if ([string]$p.Path -and ([string]$p.Path).StartsWith((Join-Path $App 'visual'), [StringComparison]::OrdinalIgnoreCase)) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
}
Start-Sleep -Seconds 2
Copy-Item -LiteralPath $Backup -Destination $Runtime -Force
Remove-Item -LiteralPath $Backup -Force
$rc = Join-Path $App 'visual\0.1.3-rc2'
if (Test-Path $rc) { Remove-Item -LiteralPath $rc -Recurse -Force }
$run = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -ErrorAction SilentlyContinue).'D2KIRO Companion'
if ($run -and $run -match '^"([^"]+)"\s+(.*)$') { Start-Process -FilePath $Matches[1] -ArgumentList $Matches[2] -WindowStyle Hidden }
Write-Host 'ROLLBACK: DONE -- the previous Companion runtime is back and restarting'
