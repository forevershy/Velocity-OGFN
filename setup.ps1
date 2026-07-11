# Velocity OGFN — one-time setup for Windows (run from the repo root)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "=== Velocity OGFN setup ===" -ForegroundColor Cyan

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js is required. Install from https://nodejs.org/ (18+)" -ForegroundColor Red
  exit 1
}

if (-not (Test-Path "config\config.json")) {
  Copy-Item "config\config.example.json" "config\config.json"
  Write-Host "Created config\config.json from example."
}

Write-Host "Installing backend dependencies..."
npm install

Write-Host "Installing launcher dependencies..."
Push-Location launcher
npm install
Pop-Location

Write-Host "Installing Discord bot dependencies..."
Push-Location discord-bot
npm install
if (-not (Test-Path "config.json")) {
  Copy-Item "config.example.json" "config.json"
  Write-Host "Created discord-bot\config.json — add your bot token before using commands."
}
Pop-Location

Write-Host ""
Write-Host "Done!" -ForegroundColor Green
Write-Host "  Backend only:  npm start"
Write-Host "  Launcher UI:   cd launcher && npm start"
Write-Host "  Discord bot:   npm run bot   (or auto-starts with Velocity when configured)"
Write-Host "  Register cmds: cd discord-bot && npm run register"
Write-Host "  Build installer for friends: cd launcher && npm run dist"
Write-Host ""
Write-Host "Or download the pre-built installer from GitHub Releases (recommended for friends)."
