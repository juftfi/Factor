# Serves this folder over HTTP so ES modules and 3D assets load correctly (avoid opening HTML via file://).
Set-Location $PSScriptRoot
$port = 8080
Write-Host ""
Write-Host "  factorAI — local server" -ForegroundColor Green
Write-Host "  http://localhost:$port/documentation.html  (docs + 3D carousel)" -ForegroundColor Cyan
Write-Host "  http://localhost:$port/                    (office)" -ForegroundColor Cyan
Write-Host ""
try {
  npx --yes serve -l $port
} catch {
  Write-Host "npx failed. Try:  python -m http.server $port" -ForegroundColor Yellow
}
