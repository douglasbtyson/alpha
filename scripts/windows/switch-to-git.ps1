# One-time setup: turns this troonooz folder (downloaded as a zip) into a Git copy of the
# GitHub repository, so troonooz can update itself each time it starts.
#
# It works in place: your .env (API key), data folder (reports and knowledge base), and
# installed packages stay exactly where they are. Only troonooz's own files are replaced
# with the latest version from GitHub.
param(
    [string]$Repo = 'https://github.com/douglasbtyson/alpha.git',
    [string]$Branch = 'claude/troonooz-news-evaluator-8v50ln'
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $root

if (-not (Test-Path (Join-Path $root 'package.json'))) {
    throw "Could not find troonooz in $root. Run this from inside the troonooz folder."
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host ''
    Write-Host 'Git is not installed yet. Install it by running this in PowerShell:'
    Write-Host '  winget install --id Git.Git -e --source winget'
    Write-Host 'Then close PowerShell, open it again, and run this script again.'
    exit 1
}
if (Test-Path (Join-Path $root '.git')) {
    Write-Host 'This folder is already a Git copy. Checking for updates instead.'
    & (Join-Path $PSScriptRoot 'update.ps1')
    exit 0
}

# Native commands report problems through exit codes, not exceptions.
$ErrorActionPreference = 'Continue'
function Check([string]$what) {
    if ($LASTEXITCODE -ne 0) {
        # Leave the folder as it was.
        Remove-Item -Recurse -Force (Join-Path $root '.git') -ErrorAction SilentlyContinue
        Write-Host ''
        Write-Host "Stopped: $what failed. Nothing was changed."
        exit 1
    }
}

Write-Host "Connecting $root to GitHub ($Branch)..."
git init --quiet; Check 'git init'
git remote add origin $Repo; Check 'adding the GitHub address'
Write-Host 'Downloading troonooz from GitHub. If a window asks you to sign in to GitHub, do so.'
git fetch --quiet origin $Branch; Check 'downloading from GitHub'
# Replace troonooz's own files with the GitHub version. Ignored files (.env, data, node_modules)
# are not touched.
git checkout --quiet --force -B $Branch "origin/$Branch"; Check 'switching to the GitHub version'
git branch --quiet --set-upstream-to "origin/$Branch" $Branch; Check 'linking the branch'

Write-Host 'Installing packages (this can take a minute)...'
npm.cmd ci --no-audit --no-fund --loglevel=error
if ($LASTEXITCODE -eq 0) {
    $hash = (Get-FileHash (Join-Path $root 'package-lock.json') -Algorithm SHA256).Hash
    Set-Content -Path (Join-Path $root 'node_modules\.troonooz-lock-hash') -Value $hash -NoNewline
} else {
    Write-Host 'Installing packages failed; troonooz will try again the next time it starts.'
}

Write-Host ''
Write-Host 'Done. troonooz now updates itself from GitHub each time it starts.'
Write-Host 'To update right away, run: .\scripts\windows\update.cmd'
Write-Host 'If troonooz is running, close its window and start it again (or sign out and in) to use the new version.'
