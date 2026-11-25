# Vencord plugin installer for Windows (TypingVerbs + ValorantDND + RandomUwU + AutoMeow),
# plus a daily check + 'Fix Discord' button for after Discord updates (needs Python).
#   irm https://raw.githubusercontent.com/ArhamAkhtarAlam/typing-indicator/main/install.ps1 | iex
# Re-run it any time to update Vencord + the plugin.
#
# Env vars:
#   $env:VENCORD_DIR = "$HOME\Vencord"   where the Vencord source build lives
#   $env:SKIP_INJECT = "1"               build only, don't patch Discord (e.g. you use Vesktop)
#   $env:PLUGINS = "valorantDnd"         only install these plugin folders (default: all of them)
#   $env:SKIP_AUTOFIX = "1"              don't set up the daily check / Fix Discord button
#   $env:PREBUILT = "1"                  skip building, use the ready-made build (install-prebuilt.ps1)
#
# If git / Node.js are missing or the build can't run (e.g. Windows blocks pnpm with a "Device Guard"
# error), it switches to the ready-made build by itself.

$ErrorActionPreference = "Stop"

$RepoUrl    = "https://github.com/ArhamAkhtarAlam/typing-indicator.git"
$VencordUrl = "https://github.com/Vendicated/Vencord.git"
$VencordDir = if ($env:VENCORD_DIR) { $env:VENCORD_DIR } else { Join-Path $HOME "Vencord" }

function Say($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Die($msg) { Write-Host "error: $msg" -ForegroundColor Red; throw $msg }  # throw, not exit: exit would close the window under iex
function Run {
    # run a native command and stop if it fails
    & $args[0] $args[1..($args.Length - 1)]
    if ($LASTEXITCODE -ne 0) { Die "'$($args -join ' ')' failed" }
}

$PrebuiltUrl = "https://raw.githubusercontent.com/ArhamAkhtarAlam/typing-indicator/main/install-prebuilt.ps1"
function Prebuilt($why) {
    if ($why) { Write-Host "$why, so using the ready-made build instead (no building needed)" -ForegroundColor Yellow }
    Invoke-Expression (Invoke-RestMethod $PrebuiltUrl)
}

# ---------- requirements ----------
$Missing = $null
if ($env:PREBUILT -eq "1") { $Missing = "" }
elseif (-not (Get-Command git -ErrorAction SilentlyContinue))  { $Missing = "git isn't installed" }
elseif (-not (Get-Command node -ErrorAction SilentlyContinue)) { $Missing = "Node.js isn't installed" }
elseif ([int](node -p "process.versions.node.split('.')[0]") -lt 22) { $Missing = "Node.js is older than v22" }
if ($null -ne $Missing) { Prebuilt $Missing; return }

# use the .cmd shims: the .ps1 ones are blocked when PowerShell script execution is disabled (the default)
$UsePnpm = [bool](Get-Command pnpm.cmd -ErrorAction SilentlyContinue)
function Pnpm {
    if ($UsePnpm) { Run pnpm.cmd @args } else { Run npx.cmd --yes pnpm @args }
}

# ---------- get plugin source ----------
$Tmp = $null
if ($PSScriptRoot -and (Test-Path (Join-Path $PSScriptRoot "typingVerbs\index.tsx"))) {
    $RepoRoot = $PSScriptRoot
} else {
    Say "Downloading TypingVerbs"
    $Tmp = Join-Path ([IO.Path]::GetTempPath()) ("typingverbs-" + [guid]::NewGuid())
    Run git clone --quiet --depth 1 $RepoUrl "$Tmp\repo"
    $RepoRoot = "$Tmp\repo"
}

try {
    # ---------- get / update Vencord source ----------
    $pkg = Join-Path $VencordDir "package.json"
    if ((Test-Path (Join-Path $VencordDir ".git")) -and (Test-Path $pkg) -and (Select-String -Path $pkg -Pattern '"name": "vencord"' -Quiet)) {
        Say "Updating Vencord in $VencordDir"
        git -C $VencordDir pull --ff-only --quiet
        if ($LASTEXITCODE -ne 0) { Write-Host "   (couldn't fast-forward, building what's there)" }
    } elseif (Test-Path $VencordDir) {
        Die "$VencordDir exists but isn't a Vencord checkout. Move it or set `$env:VENCORD_DIR to another path"
    } else {
        Say "Downloading Vencord to $VencordDir"
        Run git clone --quiet --depth 1 $VencordUrl $VencordDir
    }

    # ---------- copy plugin + build ----------
    $AllPlugins = @("typingVerbs", "valorantDnd", "randomUwu", "autoMeow")
    foreach ($old in @("noChillZone", "meowTranslator")) {   # taken down / now part of AutoMeow
        $Retired = Join-Path $VencordDir "src\userplugins\$old"
        if (Test-Path $Retired) { Remove-Item -Recurse -Force $Retired }
    }
    $Wanted = if ($env:PLUGINS) { $env:PLUGINS -split "[ ,]+" | Where-Object { $_ } } else { $AllPlugins }
    New-Item -ItemType Directory -Force -Path (Join-Path $VencordDir "src\userplugins") | Out-Null
    foreach ($p in $Wanted) {
        $src = Join-Path $RepoRoot $p
        if (-not (Test-Path $src)) { Die "unknown plugin '$p' (choose from: $($AllPlugins -join ', '))" }
        Say "Installing plugin $p"
        $dest = Join-Path $VencordDir "src\userplugins\$p"
        if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
        Copy-Item -Recurse $src $dest
    }

    $BuildFailed = $false
    Push-Location $VencordDir
    try {
        try {
            Say "Installing dependencies (first time takes a minute)"
            Pnpm install --frozen-lockfile
            Say "Building"
            Pnpm build
        } catch {
            $BuildFailed = $true
        }

        if ($BuildFailed) {
            # handled below, after leaving the Vencord folder
        } elseif ($env:SKIP_INJECT -ne "1") {
            Say "Patching Discord (pick your install if asked, then quit Discord fully when it says so)"
            Pnpm inject
            # Vencord's installer exits 0 even when it fails
            Write-Host "(If you saw 'Failed' above: fully quit Discord from the system tray and run this again.)" -ForegroundColor Yellow
        }
    } finally { Pop-Location }
    if ($BuildFailed) { Prebuilt "Couldn't build on this computer"; return }

    # ---------- auto-fix after Discord updates ----------
    # Windows has a fake "python" that just opens the Microsoft Store, so check that it really runs
    $Python = $null
    foreach ($c in @("py", "python", "python3")) {
        if (Get-Command $c -ErrorAction SilentlyContinue) {
            & $c -c "import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)" 2>$null
            if ($LASTEXITCODE -eq 0) { $Python = $c; break }
        }
    }
    $AutoFix = $false
    if ($env:SKIP_AUTOFIX -eq "1") {
        # skipped on purpose
    } elseif ($Python) {
        Say "Setting up the daily check + 'Fix Discord' desktop button"
        & $Python (Join-Path $RepoRoot "tools\discord_plugins.py") setup
        $AutoFix = ($LASTEXITCODE -eq 0)
    }
} finally {
    if ($Tmp -and (Test-Path $Tmp)) { Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue }
}

Write-Host ""
Write-Host "Done! :3" -ForegroundColor Green
Write-Host "1. Fully quit Discord (system tray -> Quit) and reopen it."
Write-Host "2. Settings -> Vencord -> Plugins, then turn on what you want:"
Write-Host "   - TypingVerbs: also turn OFF TypingTweaks, then click its cog and set your verb (e.g. meowing)"
Write-Host "   - ValorantDND: DND only while VALORANT runs (turn OFF AutoDNDWhilePlaying if it's on)"
Write-Host "   - RandomUwU: 1% of your messages get uwuified (change the chance in its cog)"
Write-Host "   - AutoMeow: paw button in the chat bar, every click sends a meow (right-click: dog/fox/bird mode)."
Write-Host "     Its speech-bubble button (or !cat / !dog) sends messages in animal language, friends with AutoMeow see the real text"
if (Test-Path (Join-Path $env:LOCALAPPDATA "vesktop")) {
    Write-Host ""
    Write-Host "Vesktop users: Vesktop Settings -> Developer Options -> Vencord Location -> pick $VencordDir\dist"
}
Write-Host ""
if ($AutoFix) {
    Write-Host "Discord updates remove Vencord. When that happens:" -ForegroundColor Cyan
    Write-Host "   - you get a popup (it checks every day at 6pm and when you log in)"
    Write-Host "   - double-click 'Fix Discord' on your desktop and it puts everything back + restarts Discord"
    Write-Host "   Plugins you turn on later are remembered automatically."
} elseif ($env:SKIP_AUTOFIX -ne "1") {
    Write-Host "To make it fix itself after Discord updates (recommended):" -ForegroundColor Yellow
    Write-Host "   1. Install Python from https://www.python.org/downloads/"
    Write-Host "      and TICK 'Add python.exe to PATH' on the first screen of the installer"
    Write-Host "   2. Close this window, open a new PowerShell and run this installer again"
    Write-Host "   You'll then get a 'Fix Discord' button on your desktop and a popup when Discord updates."
}
Write-Host ""
Write-Host "To update later, just run this installer again."
