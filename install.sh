#!/usr/bin/env bash
# Vencord plugin installer for macOS / Linux (TypingVerbs + ValorantDND).
#   curl -fsSL https://raw.githubusercontent.com/ArhamAkhtarAlam/typing-indicator/main/install.sh | bash
# Re-run it any time to update Vencord + the plugin.
#
# Env vars:
#   VENCORD_DIR=~/Vencord   where the Vencord source build lives
#   SKIP_INJECT=1           build only, don't patch Discord (e.g. you use Vesktop)
#   PLUGINS="valorantDnd"   only install these plugin folders (default: all of them)
set -euo pipefail

REPO_URL="https://github.com/ArhamAkhtarAlam/typing-indicator.git"
VENCORD_URL="https://github.com/Vendicated/Vencord.git"
VENCORD_DIR="${VENCORD_DIR:-$HOME/Vencord}"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
die()  { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# ---------- requirements ----------
command -v git  >/dev/null || die "git is not installed. Install it first (macOS: xcode-select --install)."
command -v node >/dev/null || die "Node.js is not installed. Get v22 or newer from https://nodejs.org"
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 22 ] || die "Node.js $NODE_MAJOR is too old, Vencord needs v22+. Update from https://nodejs.org"

if command -v pnpm >/dev/null; then
    pnpm() { command pnpm "$@"; }
else
    pnpm() { npx --yes pnpm "$@"; }
fi

# ---------- get plugin source ----------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || echo "")"
if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/typingVerbs/index.tsx" ]; then
    REPO_ROOT="$SCRIPT_DIR"
else
    TMP="$(mktemp -d)"
    trap 'rm -rf "$TMP"' EXIT
    bold "==> Downloading TypingVerbs"
    git clone --quiet --depth 1 "$REPO_URL" "$TMP/repo"
    REPO_ROOT="$TMP/repo"
fi

# ---------- get / update Vencord source ----------
if [ -d "$VENCORD_DIR/.git" ] && grep -q '"name": "vencord"' "$VENCORD_DIR/package.json" 2>/dev/null; then
    bold "==> Updating Vencord in $VENCORD_DIR"
    git -C "$VENCORD_DIR" pull --ff-only --quiet || echo "   (couldn't fast-forward, building what's there)"
elif [ -e "$VENCORD_DIR" ]; then
    die "$VENCORD_DIR exists but isn't a Vencord checkout. Move it or set VENCORD_DIR=/some/other/path"
else
    bold "==> Downloading Vencord to $VENCORD_DIR"
    git clone --quiet --depth 1 "$VENCORD_URL" "$VENCORD_DIR"
fi

# ---------- copy plugin + build ----------
ALL_PLUGINS="typingVerbs valorantDnd randomUwu autoMeow"
mkdir -p "$VENCORD_DIR/src/userplugins"
for p in ${PLUGINS:-$ALL_PLUGINS}; do
    [ -d "$REPO_ROOT/$p" ] || die "unknown plugin '$p' (choose from: $ALL_PLUGINS)"
    bold "==> Installing plugin $p"
    rm -rf "$VENCORD_DIR/src/userplugins/$p"
    cp -R "$REPO_ROOT/$p" "$VENCORD_DIR/src/userplugins/$p"
done

cd "$VENCORD_DIR"
bold "==> Installing dependencies (first time takes a minute)"
pnpm install --frozen-lockfile
bold "==> Building"
pnpm build

# ---------- patch Discord ----------
HAS_VESKTOP=0
{ [ -d /Applications/Vesktop.app ] || command -v vesktop >/dev/null || flatpak info dev.vencord.Vesktop >/dev/null 2>&1; } && HAS_VESKTOP=1

# Discord installs to check (macOS + common Linux locations)
discord_asars() {
    for f in /Applications/Discord*.app/Contents/Resources/app.asar \
             "$HOME/Applications"/Discord*.app/Contents/Resources/app.asar \
             /opt/discord*/resources/app.asar /opt/Discord*/resources/app.asar \
             /usr/share/discord*/resources/app.asar /usr/lib/discord*/resources/app.asar \
             "$HOME/.local/share/discord"*/resources/app.asar; do
        [ -f "$f" ] && echo "$f"
    done
}

# If Discord is already patched with Vencord (e.g. from the official installer), it loads
# <somewhere>/dist/patcher.js. Point that dist folder at our build with a symlink instead of
# re-patching Discord: no admin rights or macOS App Management permission needed, and your
# Vencord settings stay put.
relink_existing() {
    local asar target dist linked=0
    while IFS= read -r asar; do
        target=$(grep -ao 'require("[^"]*/patcher\.js")' "$asar" 2>/dev/null | head -1 | sed 's/^require("//; s/")$//')
        [ -n "$target" ] || continue
        dist=$(dirname "$target")
        if [ "$dist" = "$VENCORD_DIR/dist" ] || [ "$(readlink "$dist" 2>/dev/null)" = "$VENCORD_DIR/dist" ]; then
            linked=1; continue
        fi
        [ -w "$(dirname "$dist")" ] || continue
        if [ -L "$dist" ]; then
            rm "$dist"
        elif [ -e "$dist" ]; then
            mv "$dist" "$dist.backup-$(date +%Y%m%d-%H%M%S)"
        fi
        ln -s "$VENCORD_DIR/dist" "$dist"
        echo "   Linked $dist -> $VENCORD_DIR/dist (old build backed up next to it)"
        linked=1
    done < <(discord_asars)
    [ "$linked" = 1 ]
}

if [ "${SKIP_INJECT:-0}" != 1 ]; then
    bold "==> Hooking up Discord"
    if relink_existing; then
        echo "   Discord already has Vencord, now pointing it at this build."
    else
        bold "==> Patching Discord (pick your install if asked, then quit Discord fully when it says so)"
        if [ -r /dev/tty ]; then pnpm inject </dev/tty; else pnpm inject; fi

        # Vencord's installer exits 0 even when it fails, so check the result ourselves
        OK=0; ANY=0
        while IFS= read -r asar; do
            ANY=1
            grep -qF "$VENCORD_DIR/dist" "$asar" 2>/dev/null && OK=1
        done < <(discord_asars)
        if [ "$ANY" = 1 ] && [ "$OK" = 0 ]; then
            echo
            printf '\033[31m%s\033[0m\n' "Patching Discord failed, so it isn't using the new build yet."
            if [ "$(uname)" = Darwin ]; then
                echo "macOS is blocking your terminal from changing apps. To fix it:"
                echo "  1. System Settings → Privacy & Security → App Management → turn ON your terminal app"
                echo "     (Terminal / iTerm / whichever you ran this in). Restart that app if asked."
                echo "  2. Quit Discord (Cmd+Q), then run this installer again."
            else
                echo "Close Discord completely and run this installer again (with sudo if Discord is in /opt or /usr)."
            fi
            exit 1
        fi
    fi
fi

echo
bold "Done! 🐱"
echo "1. Fully quit Discord and reopen it."
echo "2. Settings → Vencord → Plugins, then turn on what you want:"
echo "   • TypingVerbs: also turn OFF TypingTweaks, then click its cog and set your verb (e.g. meowing)"
echo "   • ValorantDND: DND only while VALORANT runs (turn OFF AutoDNDWhilePlaying if it's on)"
if [ "$HAS_VESKTOP" = 1 ]; then
    echo
    echo "Vesktop users: Vesktop Settings → Developer Options → Vencord Location → pick $VENCORD_DIR/dist"
fi
echo
echo "To update later, just run this installer again."
