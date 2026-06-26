# run-tests.ps1 — the lab's automated test runner for the LOCKED machine.
# Playwright/Node are blocked here (Application Control blocks native DLLs / no Node),
# so we drive the installed, signed Chrome in headless mode and read the in-browser
# test result via --dump-dom. Zero extra installs, passes Application Control.
#
# Usage:  powershell -ExecutionPolicy Bypass -File lab\tests\run-tests.ps1
# Exit code 0 = all passed, 1 = failures, 2 = harness error.

param(
  [string]$Page = "http://localhost:8731/lab/tests/test-runner.html",
  [int]$Port = 8731,
  [string]$Root = "c:\Users\aseel\OneDrive\ai code progects\storage tool"
)

$chrome = @(
  "C:\Program Files\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { Write-Error "No Chrome/Edge found"; exit 2 }

# Ensure a local static server is up (ES modules need http://, not file://).
$alive = $false
try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "http://localhost:$Port/" | Out-Null; $alive = $true } catch {}
if (-not $alive) {
  Start-Process -FilePath "python" -ArgumentList "-m","http.server","$Port" -WorkingDirectory $Root -WindowStyle Hidden
  Start-Sleep -Seconds 2
}

$dump = "$env:TEMP\tm_dump.html"
Start-Process -FilePath $chrome -ArgumentList '--headless','--disable-gpu','--no-sandbox',`
  '--virtual-time-budget=10000','--dump-dom',$Page `
  -RedirectStandardOutput $dump -RedirectStandardError "$env:TEMP\tm_err.txt" -NoNewWindow -Wait

$out = Get-Content $dump -Raw
$m = [regex]::Match($out, '@@RESULT@@(.*?)@@END@@')
if (-not $m.Success) { Write-Error "No test result marker in DOM dump"; exit 2 }

$res = $m.Groups[1].Value | ConvertFrom-Json
Write-Output ("TESTS  passed={0}  failed={1}  total={2}" -f $res.passed, $res.failed, $res.total)
if ($res.failed -eq 0) { Write-Output "ALL PASSED"; exit 0 } else { Write-Output "FAILURES"; exit 1 }
