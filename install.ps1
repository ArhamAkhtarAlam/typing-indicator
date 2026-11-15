# Vencord plugin installer for Windows (TypingVerbs + ValorantDND).
#   irm https://raw.githubusercontent.com/ArhamAkhtarAlam/typing-indicator/main/install.ps1 | iex
# Re-run it any time to update Vencord + the plugin.
#
# Env vars:
#   $env:VENCORD_DIR = "$HOME\Vencord"   where the Vencord source build lives
#   $env:SKIP_INJECT = "1"               build only, don't patch Discord (e.g. you use Vesktop)
#   $env:PLUGINS = "valorantDnd"         only install these plugin folders (default: all of them)

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

# ---------- requirements ----------
if (-not (Get-Command git -ErrorAction SilentlyContinue))  { Die "git is not installed. Get it from https://git-scm.com/download/win" }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Die "Node.js is not installed. Get v22 or newer from https://nodejs.org" }
$nodeMajor = [int](node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 22) { Die "Node.js $nodeMajor is too old, Vencord needs v22+. Update from https://nodejs.org" }

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
    $AllPlugins = @("typingVerbs", "valorantDnd")
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

    Push-Location $VencordDir
    try {
        Say "Installing dependencies (first time takes a minute)"
        Pnpm install --frozen-lockfile
        Say "Building"
        Pnpm build

        if ($env:SKIP_INJECT -ne "1") {
            Say "Patching Discord (pick your install if asked, then quit Discord fully when it says so)"
            Pnpm inject
            # Vencord's installer exits 0 even when it fails
            Write-Host "(If you saw 'Failed' above: fully quit Discord from the system tray and run this again.)" -ForegroundColor Yellow
        }
    } finally { Pop-Location }
} finally {
    if ($Tmp -and (Test-Path $Tmp)) { Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue }
}

Write-Host ""
Write-Host "Done! :3" -ForegroundColor Green
Write-Host "1. Fully quit Discord (system tray -> Quit) and reopen it."
Write-Host "2. Settings -> Vencord -> Plugins, then turn on what you want:"
Write-Host "   - TypingVerbs: also turn OFF TypingTweaks, then click its cog and set your verb (e.g. meowing)"
Write-Host "   - ValorantDND: DND only while VALORANT runs (turn OFF AutoDNDWhilePlaying if it's on)"
if (Test-Path (Join-Path $env:LOCALAPPDATA "vesktop")) {
    Write-Host ""
    Write-Host "Vesktop users: Vesktop Settings -> Developer Options -> Vencord Location -> pick $VencordDir\dist"
}
Write-Host ""
Write-Host "To update later, just run this installer again."
