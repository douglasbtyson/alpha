# Makes troonooz start automatically when you sign in to Windows, by adding a
# shortcut to your Startup folder. It runs in a minimized window; close that
# window to stop troonooz. No administrator rights needed.
$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$target = Join-Path $PSScriptRoot 'troonooz-autostart.cmd'
$startup = [Environment]::GetFolderPath('Startup')
$link = Join-Path $startup 'troonooz.lnk'

if (-not (Test-Path (Join-Path $root 'package.json'))) {
    throw "Could not find troonooz in $root. Run this from inside the troonooz folder."
}
if (-not (Test-Path (Join-Path $root '.env'))) {
    Write-Warning "No .env file in $root. troonooz needs your ANTHROPIC_API_KEY there."
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($link)
$shortcut.TargetPath = $target
$shortcut.WorkingDirectory = $root
$shortcut.WindowStyle = 7  # minimized
$shortcut.Description = 'Start troonooz when you sign in'
$shortcut.Save()

Write-Host ''
Write-Host 'Done. troonooz will start automatically (minimized) each time you sign in to Windows.'
Write-Host "Shortcut: $link"
Write-Host 'To turn this off, run: .\scripts\windows\uninstall-autostart.cmd'
