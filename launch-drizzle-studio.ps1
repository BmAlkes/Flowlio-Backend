# Launch Chrome with disabled web security for Drizzle Studio
# This allows HTTPS pages (local.drizzle.studio) to access HTTP localhost

$chromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$userDataDir = "$env:TEMP\chrome-drizzle-studio"

# Check if Chrome exists
if (-not (Test-Path $chromePath)) {
    Write-Host "Chrome not found at: $chromePath" -ForegroundColor Red
    Write-Host "Please update the path in this script to your Chrome installation" -ForegroundColor Yellow
    exit 1
}

# Create temp directory for Chrome user data
if (-not (Test-Path $userDataDir)) {
    New-Item -ItemType Directory -Path $userDataDir | Out-Null
}

Write-Host "Launching Chrome with disabled web security for Drizzle Studio..." -ForegroundColor Green
Write-Host "WARNING: This Chrome instance will have reduced security!" -ForegroundColor Yellow
Write-Host "Close this Chrome window when you're done with Drizzle Studio." -ForegroundColor Yellow
Write-Host ""

# Launch Chrome with flags
Start-Process $chromePath -ArgumentList @(
    "--user-data-dir=$userDataDir",
    "--disable-web-security",
    "--disable-features=VizDisplayCompositor",
    "--allow-running-insecure-content",
    "https://local.drizzle.studio"
)

Write-Host "Chrome launched! Access Drizzle Studio at: https://local.drizzle.studio" -ForegroundColor Green

