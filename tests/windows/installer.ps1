# Tests install-prebuilt.ps1 against fake Discord folders (no real Discord is touched).
# On GitHub this runs in Windows PowerShell 5.1, like on friends' PCs:
#   powershell -NoProfile -ExecutionPolicy Bypass -File tests\windows\installer.ps1
# Needs `npm ci` first (it reads the app.asar with Electron's asar library) and internet (downloads the
# ready-made build from the "prebuilt" release).

$ErrorActionPreference = "Stop"
$repo = Split-Path (Split-Path $PSScriptRoot)   # (paths built with Join-Path, so this also runs on Linux pwsh)
function P { $p = $args[0]; foreach ($x in $args[1..($args.Count - 1)]) { $p = Join-Path $p $x }; return $p }
$installer = Get-Content -Raw (Join-Path $repo "install-prebuilt.ps1")
$readAsar = P $repo "tests" "windows" "read-asar.mjs"
$base = Join-Path ([IO.Path]::GetTempPath()) ("discord-plugins-test-" + [guid]::NewGuid())
$failed = 0

function Check($ok, $what) {
    if ($ok) { Write-Host "ok   - $what" -ForegroundColor Green }
    else { Write-Host "FAIL - $what" -ForegroundColor Red; $script:failed++ }
}

# a fake %LOCALAPPDATA% with one Discord version; $layout = which files resources\ starts with
function FakeDiscord($name, $layout) {
    $local = Join-Path $base $name
    $res = P $local "Discord" "app-1.0.9269" "resources"
    New-Item -ItemType Directory -Force -Path $res | Out-Null
    foreach ($f in $layout.Keys) {
        if ($f -eq "app") { New-Item -ItemType Directory -Force -Path (Join-Path $res "app") | Out-Null; Set-Content (P $res "app" "index.js") "x" }
        else { Set-Content -Path (Join-Path $res $f) -Value $layout[$f] -NoNewline }
    }
    $env:LOCALAPPDATA = $local
    return $res
}
function Install { Invoke-Expression $installer *> $null }
function ReadAsar($res) { return node $readAsar (Join-Path $res "app.asar") | ConvertFrom-Json }
function Text($path) { return (Get-Content -Raw $path) }
function CheckPatched($res, $real, $label) {
    Check (-not (Test-Path (Join-Path $res "app"))) "$label`: no leftover app\ folder"
    Check ((Text (Join-Path $res "_app.asar")) -eq $real) "$label`: Discord's real app.asar kept as _app.asar"
    $a = ReadAsar $res
    Check ($a.files -contains "index.js" -and $a.files -contains "package.json") "$label`: app.asar has index.js + package.json"
    Check ($a.main -eq "index.js") "$label`: package.json main is index.js"
    $want = P $env:LOCALAPPDATA "discord-plugins" "vencord" "patcher.js"
    Check ($a.patcherPath -eq $want) "$label`: index.js loads $want (got $($a.patcherPath))"
    Check (Test-Path $a.patcherPath) "$label`: that patcher.js exists"
}

try {
    $env:UNINSTALL = ""

    # 1. Discord as it comes: only app.asar
    $res = FakeDiscord "clean" @{ "app.asar" = "ORIGINAL" }
    Install
    CheckPatched $res "ORIGINAL" "fresh Discord"
    $renderer = P $env:LOCALAPPDATA "discord-plugins" "vencord" "renderer.js"
    foreach ($p in "TypingVerbs", "ValorantDND", "RandomUwU", "AutoMeow") {
        Check (Select-String -Path $renderer -Pattern "name:`"$p`"" -SimpleMatch -Quiet) "downloaded build contains $p"
    }

    # 2. running it again doesn't lose Discord's real app.asar
    Install
    CheckPatched $res "ORIGINAL" "second run"

    # 3. uninstall puts Discord back exactly
    $env:UNINSTALL = "1"; Install; $env:UNINSTALL = ""
    Check ((Text (Join-Path $res "app.asar")) -eq "ORIGINAL") "uninstall: app.asar is Discord's real one again"
    Check (-not (Test-Path (Join-Path $res "_app.asar"))) "uninstall: no _app.asar left"

    # 4. the situation on a friend's PC: official Vencord installed + the old app\ folder
    $res = FakeDiscord "official" @{ "app" = ""; "app.asar" = "OFFICIAL-VENCORD-STUB"; "_app.asar" = "REALDISCORD" }
    Install
    CheckPatched $res "REALDISCORD" "over official Vencord"

    # 5. a user name with an accent
    $res = FakeDiscord "Jos$([char]0xe9)" @{ "app.asar" = "ORIGINAL" }
    Install
    CheckPatched $res "ORIGINAL" "accented user name"
} finally {
    Remove-Item -Recurse -Force $base -ErrorAction SilentlyContinue
}

if ($failed) { Write-Host "$failed check(s) failed" -ForegroundColor Red; exit 1 }
Write-Host "all installer checks passed" -ForegroundColor Green
