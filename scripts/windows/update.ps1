# Brings this troonooz folder up to date with GitHub.
#
# troonooz runs this each time it starts (see troonooz-autostart.cmd), and you can run it any
# time with update.cmd. It never stops troonooz from starting: if anything goes wrong (no
# internet yet, GitHub needs you to sign in again), it says so and keeps the version you have.
#
# -Unattended: used at startup. Never waits for a sign-in window, and retries once in case the
#              PC is still connecting to the internet.
param([switch]$Unattended)

$ErrorActionPreference = 'Continue'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $root

function Say([string]$message) { Write-Host "[update] $message" }

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Say 'Git is not installed, so troonooz cannot update itself. See "Keep troonooz up to date" in README.md.'
    exit 0
}
if (-not (Test-Path (Join-Path $root '.git'))) {
    Say 'This troonooz folder came from a zip, so it cannot update itself.'
    Say 'To fix that, run this once: .\scripts\windows\switch-to-git.cmd'
    exit 0
}

# The port troonooz listens on (PORT in .env, else 8787). If it is in use, troonooz is running.
$port = 8787
$envFile = Join-Path $root '.env'
if (Test-Path $envFile) {
    $m = Select-String -Path $envFile -Pattern '^\s*PORT\s*=\s*(\d+)' | Select-Object -First 1
    if ($m) { $port = [int]$m.Matches[0].Groups[1].Value }
}
$running = [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)

$env:GIT_TERMINAL_PROMPT = '0'
if ($Unattended) { $env:GCM_INTERACTIVE = 'never' }

$before = (git rev-parse HEAD).Trim()
# --autostash keeps any changes made in this folder (for example mobile/app.json after an Expo
# build) and puts them back after updating. Setting it aside needs a name, which a fresh Git
# install doesn't have yet.
function Pull { git -c user.name=troonooz -c user.email=troonooz@localhost pull --ff-only --autostash --quiet }
Pull
if ($LASTEXITCODE -ne 0 -and $Unattended) {
    Say 'Could not reach GitHub yet. Trying again in 15 seconds...'
    Start-Sleep -Seconds 15
    Pull
}
if ($LASTEXITCODE -ne 0) {
    Say 'Could not download updates, so troonooz will run the version you already have.'
    Say 'Check the internet connection, then run .\scripts\windows\update.cmd (it can ask you to sign in to GitHub).'
    exit 0
}

$after = (git rev-parse HEAD).Trim()
if ($before -eq $after) {
    Say 'troonooz is up to date.'
} else {
    Say 'Downloaded these changes:'
    git --no-pager log --oneline --no-decorate "$before..$after" | Select-Object -First 15 | ForEach-Object { Write-Host "  $_" }
}

# Reinstall packages when package-lock.json differs from the one node_modules was installed from.
# `npm ci` installs exactly what the lock file lists and never rewrites it.
$lock = Join-Path $root 'package-lock.json'
$marker = Join-Path $root 'node_modules\.troonooz-lock-hash'
$want = (Get-FileHash $lock -Algorithm SHA256).Hash
$have = if (Test-Path $marker) { (Get-Content $marker -Raw).Trim() } else { '' }
if ($want -ne $have) {
    if ($running) {
        Say 'This update includes new packages. Close the troonooz window and start troonooz again to finish updating.'
        exit 0
    }
    Say 'Installing updated packages (this can take a minute)...'
    npm.cmd ci --no-audit --no-fund --loglevel=error
    if ($LASTEXITCODE -eq 0) {
        Set-Content -Path $marker -Value $want -NoNewline
    } else {
        Say 'Installing packages failed. Run "npm.cmd ci" in this folder to see why.'
    }
} elseif ($running -and $before -ne $after) {
    Say 'troonooz is running and picks up the changes by itself (refresh open pages).'
}
exit 0
