# Ready-made Vencord + all the plugins (TypingVerbs, ValorantDND, RandomUwU, AutoMeow) for Windows.
# No git, Node.js or building needed, and it runs no .exe files, so it also works when Windows blocks
# pnpm ("blocked by your organization's Device Guard policy" / Smart App Control).
#   irm https://raw.githubusercontent.com/ArhamAkhtarAlam/typing-indicator/main/install-prebuilt.ps1 | iex
# Run it again after a Discord update (or double-click 'Fix Discord' on your desktop).
#
# Env vars:
#   $env:UNINSTALL = "1"   take Vencord out of Discord again

$ErrorActionPreference = "Stop"

$Release   = "https://github.com/ArhamAkhtarAlam/typing-indicator/releases/download/prebuilt"
$ThisUrl   = "https://raw.githubusercontent.com/ArhamAkhtarAlam/typing-indicator/main/install-prebuilt.ps1"
$Files     = @("patcher.js", "preload.js", "renderer.js", "renderer.css", "version.txt")
$VencordAt = Join-Path $env:LOCALAPPDATA "discord-plugins\vencord"
$Flavors   = @("Discord", "DiscordPTB", "DiscordCanary")

function Say($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Die($msg) { Write-Host "error: $msg" -ForegroundColor Red; throw $msg }  # throw, not exit: exit would close the window under iex

try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor 3072 } catch { }  # TLS 1.2 on old PowerShell

# ---------- find Discord ----------
$Installs = @()
foreach ($f in $Flavors) {
    $base = Join-Path $env:LOCALAPPDATA $f
    if (-not (Test-Path $base)) { continue }
    # newest app-x.y.z folder (Discord makes a new one on every update)
    $app = Get-ChildItem -Path $base -Directory -Filter "app-*" |
        Sort-Object { $v = $_.Name -replace '^app-', ''; try { [version]$v } catch { [version]"0.0" } } |
        Select-Object -Last 1
    if ($app -and (Test-Path (Join-Path $app.FullName "resources\app.asar"))) {
        $Installs += [pscustomobject]@{ Name = $f; Base = $base; Resources = Join-Path $app.FullName "resources" }
    }
}
if (-not $Installs) { Die "couldn't find Discord in $env:LOCALAPPDATA. Install it from https://discord.com/download first" }

# ---------- download the ready-made build ----------
if ($env:UNINSTALL -ne "1") {
    Say "Downloading Vencord + plugins"
    $New = "$VencordAt.new"
    if (Test-Path $New) { Remove-Item -Recurse -Force $New }
    New-Item -ItemType Directory -Force -Path $New | Out-Null
    foreach ($f in $Files) {
        try { Invoke-WebRequest -UseBasicParsing -Uri "$Release/$f" -OutFile (Join-Path $New $f) }
        catch { Die "couldn't download $f ($($_.Exception.Message)). Check your internet and try again" }
    }
}

# ---------- Discord has to be closed ----------
$names = $Installs | ForEach-Object { $_.Name }
if (Get-Process -Name $names -ErrorAction SilentlyContinue) {
    Write-Host ""
    Write-Host "Close Discord fully: right-click its icon near the clock (bottom right, maybe under the ^ arrow)" -ForegroundColor Yellow
    Write-Host "and click 'Quit Discord'. Closing the window isn't enough. Waiting..." -ForegroundColor Yellow
    while (Get-Process -Name $names -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 1 }
    Start-Sleep -Seconds 2
    Say "Discord is closed"
}

if ($env:UNINSTALL -ne "1") {
    if (Test-Path $VencordAt) { Remove-Item -Recurse -Force $VencordAt }
    Move-Item $New $VencordAt
}

# ---------- patch ----------
# Discord loads resources\app\ before resources\app.asar, so a small folder that loads Vencord is enough,
# and Discord's own app.asar stays untouched (Vencord loads it afterwards).
# Discord updates go into a new app-x.y.z folder, so the loader copies itself there (on quit, at start
# and every 30 min). Vencord's own copier is turned off: it's made for the app.asar way of patching and
# would copy Discord's plain app.asar over the new version.
$Loader = @'
process.env.DISABLE_UPDATER_AUTO_PATCHING = "1";
try {
    const { app } = require("electron");
    const fs = require("original-fs");
    const path = require("path");
    const parts = name => name.slice(4).split(".").map(Number);
    const newer = (a, b) => {
        const x = parts(a), y = parts(b);
        for (let i = 0; i < Math.max(x.length, y.length); i++)
            if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
        return false;
    };
    const carry = () => {
        try {
            const current = path.basename(path.join(__dirname, "..", ".."));
            const root = path.join(__dirname, "..", "..", "..");
            for (const d of fs.readdirSync(root)) {
                if (!d.startsWith("app-") || !newer(d, current)) continue;
                const res = path.join(root, d, "resources"), dest = path.join(res, "app");
                if (fs.existsSync(dest)) continue;
                // undo the app.asar way of patching (Discord's real app.asar was renamed to _app.asar)
                if (fs.existsSync(path.join(res, "_app.asar"))) {
                    fs.rmSync(path.join(res, "app.asar"), { force: true });
                    fs.renameSync(path.join(res, "_app.asar"), path.join(res, "app.asar"));
                }
                if (!fs.existsSync(path.join(res, "app.asar"))) continue;
                fs.mkdirSync(dest);
                for (const f of ["index.js", "package.json"]) fs.copyFileSync(path.join(__dirname, f), path.join(dest, f));
                console.log("[discord-plugins] Vencord carried over to " + d);
            }
        } catch (e) { console.error("[discord-plugins] couldn't carry Vencord over to the new Discord version", e); }
    };
    carry();
    setInterval(carry, 30 * 60 * 1000).unref?.();
    app.on("before-quit", carry);
} catch (e) { console.error("[discord-plugins]", e); }
require("PATCHER_PATH");
'@
$patcher = (Join-Path $VencordAt "patcher.js") -replace '\\', '\\'
foreach ($i in $Installs) {
    $res = $i.Resources
    $appDir = Join-Path $res "app"
    # undo the other way of patching (Vencord's installer renames Discord's app.asar to _app.asar)
    if (Test-Path (Join-Path $res "_app.asar")) {
        Remove-Item -Force (Join-Path $res "app.asar")
        Rename-Item (Join-Path $res "_app.asar") "app.asar"
    }
    if (Test-Path $appDir) { Remove-Item -Recurse -Force $appDir }
    if ($env:UNINSTALL -eq "1") { Say "Removed Vencord from $($i.Name)"; continue }

    New-Item -ItemType Directory -Force -Path $appDir | Out-Null
    Set-Content -Path (Join-Path $appDir "index.js") -Value $Loader.Replace("PATCHER_PATH", $patcher) -Encoding ASCII
    Set-Content -Path (Join-Path $appDir "package.json") -Value '{ "name": "discord", "main": "index.js" }' -Encoding ASCII
    Say "Patched $($i.Name)"
}

if ($env:UNINSTALL -ne "1") {
    # a 'Fix Discord' button on the desktop that just runs this again
    try {
        $desktop = [Environment]::GetFolderPath("Desktop")
        if (-not $desktop) { $desktop = Join-Path $HOME "Desktop" }
        Set-Content -Path (Join-Path $desktop "Fix Discord.cmd") -Encoding ASCII -Value @(
            "@echo off",
            "powershell -NoProfile -Command `"irm $ThisUrl | iex`"",
            "pause"
        )
    } catch { }
}

# ---------- start Discord again ----------
foreach ($i in $Installs) {
    $update = Join-Path $i.Base "Update.exe"
    if (Test-Path $update) { Start-Process $update -ArgumentList "--processStart", "$($i.Name).exe" }
}

Write-Host ""
if ($env:UNINSTALL -eq "1") { Write-Host "Done, Vencord is removed." -ForegroundColor Green; return }
Write-Host "Done! :3 Discord is starting with Vencord." -ForegroundColor Green
Write-Host "Settings -> Vencord -> Plugins, then turn on what you want: AutoMeow, RandomUwU, TypingVerbs, ValorantDND."
Write-Host "(RandomUwU's !uwu trap: also turn on 'Let friends type !uwu' in its settings.)"
Write-Host ""
Write-Host "Discord updates remove Vencord. When that happens, double-click 'Fix Discord' on your desktop" -ForegroundColor Cyan
Write-Host "(or run this command again). It also gets you the newest plugins."
