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
# Same way as Vencord's own installer: Discord's app.asar is renamed to _app.asar, and a tiny app.asar
# that loads Vencord takes its place (Vencord then loads _app.asar itself). Vencord also copies this
# tiny app.asar into new Discord versions by itself, so it survives Discord updates.

# anything that isn't plain ASCII is written as \uXXXX in the JS (so user names like "José" work)
function AsciiJs($s) {
    $out = ""
    foreach ($c in $s.ToCharArray()) { if ([int]$c -gt 126) { $out += '\u{0:x4}' -f [int]$c } else { $out += $c } }
    return $out
}
function Bytes($s) { return , ([byte[]][char[]]$s) }
function U32($n) { return , ([byte[]]@(($n -band 255), (($n -shr 8) -band 255), (($n -shr 16) -band 255), (($n -shr 24) -band 255))) }

# an asar file: [4][header size][header json as a "pickle" string][the files back to back]
function AsarBytes($files) {
    $json = '{"files":{'
    $offset = 0
    $first = $true
    foreach ($f in $files) {
        if (-not $first) { $json += "," }
        $first = $false
        $json += '"' + $f.Name + '":{"size":' + $f.Bytes.Length + ',"offset":"' + $offset + '"}'
        $offset += $f.Bytes.Length
    }
    $json += '}}'
    $jb = Bytes $json
    $pad = (4 - ($jb.Length % 4)) % 4
    $headerPickle = 8 + $jb.Length + $pad
    $all = New-Object System.Collections.Generic.List[byte]
    $all.AddRange((U32 4)); $all.AddRange((U32 $headerPickle))
    $all.AddRange((U32 ($headerPickle - 4))); $all.AddRange((U32 $jb.Length))
    $all.AddRange($jb)
    for ($k = 0; $k -lt $pad; $k++) { $all.Add(0) }
    foreach ($f in $files) { $all.AddRange($f.Bytes) }
    return , $all.ToArray()
}
function WriteBytes($path, $bytes) {
    if ($PSVersionTable.PSVersion.Major -ge 6) { Set-Content -Path $path -Value $bytes -AsByteStream }
    else { Set-Content -Path $path -Value $bytes -Encoding Byte }
}

$patcher = AsciiJs ((Join-Path $VencordAt "patcher.js") -replace '\\', '\\')
$Stub = AsarBytes @(
    [pscustomobject]@{ Name = "index.js"; Bytes = (Bytes "require(`"$patcher`");`n") },
    [pscustomobject]@{ Name = "package.json"; Bytes = (Bytes '{ "name": "discord", "main": "index.js" }') }
)

foreach ($i in $Installs) {
    $res = $i.Resources
    $asar = Join-Path $res "app.asar"
    $real = Join-Path $res "_app.asar"
    # the old way this script patched (an app\ folder Discord ignores): remove it
    $appDir = Join-Path $res "app"
    if (Test-Path $appDir) { Remove-Item -Recurse -Force $appDir }

    if ($env:UNINSTALL -eq "1") {
        if (Test-Path $real) {
            Remove-Item -Force $asar
            Rename-Item $real "app.asar"
        }
        Say "Removed Vencord from $($i.Name)"
        continue
    }

    # _app.asar already there = patched before (by this or the official Vencord installer): keep
    # Discord's real one and just put our loader in front of it
    if (-not (Test-Path $real)) { Rename-Item $asar "_app.asar" }
    WriteBytes $asar $Stub
    Say "Patched $($i.Name)"
}

if ($env:UNINSTALL -ne "1") {
    # a 'Fix Discord' button on the desktop that just runs this again
    # find the real Desktop (it can be inside OneDrive), without .NET calls that locked-down PowerShell blocks
    $desktops = @()
    try { $desktops += (Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders" -ErrorAction Stop).Desktop } catch { }
    try { $desktops += [Environment]::GetFolderPath("Desktop") } catch { }
    if ($env:OneDrive) { $desktops += Join-Path $env:OneDrive "Desktop" }
    $desktops += Join-Path $env:USERPROFILE "Desktop"
    $FixButton = $null
    foreach ($d in $desktops) {
        if (-not $d -or -not (Test-Path $d)) { continue }
        try {
            $FixButton = Join-Path $d "Fix Discord.cmd"
            Set-Content -Path $FixButton -Encoding ASCII -Value @(
                "@echo off",
                "powershell -NoProfile -ExecutionPolicy Bypass -Command `"irm $ThisUrl | iex`"",
                "pause"
            )
            break
        } catch { $FixButton = $null }
    }
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
Write-Host "Vencord moves along with Discord updates by itself. If it's ever gone, or you want the newest plugins:" -ForegroundColor Cyan
if ($FixButton) {
    Write-Host "   double-click 'Fix Discord' on your desktop ($FixButton), or run this command again."
} else {
    Write-Host "   run this command again. (Couldn't put a 'Fix Discord' button on your desktop.)"
}
