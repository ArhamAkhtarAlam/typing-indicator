#!/usr/bin/env bash
# TypingVerbs installer for macOS / Linux.
#   curl -fsSL https://raw.githubusercontent.com/ArhamAkhtarAlam/typing-indicator/main/install.sh | bash
# Re-run it any time to update Vencord + the plugin.
#
# Env vars:
#   VENCORD_DIR=~/Vencord   where the Vencord source build lives
#   SKIP_INJECT=1           build only, don't patch Discord (e.g. you use Vesktop)
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
    PLUGIN_SRC="$SCRIPT_DIR/typingVerbs"
else
    TMP="$(mktemp -d)"
    trap 'rm -rf "$TMP"' EXIT
    bold "==> Downloading TypingVerbs"
    git clone --quiet --depth 1 "$REPO_URL" "$TMP/repo"
    PLUGIN_SRC="$TMP/repo/typingVerbs"
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
bold "==> Installing plugin"
mkdir -p "$VENCORD_DIR/src/userplugins"
rm -rf "$VENCORD_DIR/src/userplugins/typingVerbs"
cp -R "$PLUGIN_SRC" "$VENCORD_DIR/src/userplugins/typingVerbs"

cd "$VENCORD_DIR"
bold "==> Installing dependencies (first time takes a minute)"
pnpm install --frozen-lockfile
bold "==> Building"
pnpm build

# ---------- patch Discord ----------
HAS_VESKTOP=0
{ [ -d /Applications/Vesktop.app ] || command -v vesktop >/dev/null || flatpak info dev.vencord.Vesktop >/dev/null 2>&1; } && HAS_VESKTOP=1

if [ "${SKIP_INJECT:-0}" != 1 ]; then
    bold "==> Patching Discord (pick your install if asked, then quit Discord fully when it says so)"
    if [ -r /dev/tty ]; then pnpm inject </dev/tty; else pnpm inject; fi

    # Vencord's installer exits 0 even when it fails, so check the result ourselves (macOS)
    if [ "$(uname)" = Darwin ]; then
        PATCHED=0; FOUND=0
        for app in /Applications/Discord*.app "$HOME/Applications"/Discord*.app; do
            asar="$app/Contents/Resources/app.asar"
            [ -f "$asar" ] || continue
            FOUND=1
            grep -qF "$VENCORD_DIR/dist" "$asar" 2>/dev/null && PATCHED=1
        done
        if [ "$FOUND" = 1 ] && [ "$PATCHED" = 0 ]; then
            echo
            printf '\033[31m%s\033[0m\n' "Discord isn't using your new build yet. Patching it failed (probably 'operation not permitted')."
            echo "macOS is blocking Terminal from changing apps. To fix it:"
            echo "  1. System Settings → Privacy & Security → App Management → turn ON your terminal app"
            echo "     (Terminal / iTerm / Claude, whichever you ran this in). Restart that app if asked."
            echo "  2. Quit Discord (Cmd+Q), then run this installer again."
            exit 1
        fi
    else
        echo "(If you saw '❌ Failed' above, run this again with admin rights or close Discord first.)"
    fi
fi

echo
bold "Done! 🐱"
echo "1. Fully quit Discord and reopen it."
echo "2. Settings → Vencord → Plugins: turn OFF TypingTweaks, turn ON TypingVerbs."
echo "3. Click the cog next to TypingVerbs and set your verb (e.g. meowing)."
if [ "$HAS_VESKTOP" = 1 ]; then
    echo
    echo "Vesktop users: Vesktop Settings → Developer Options → Vencord Location → pick $VENCORD_DIR/dist"
fi
echo
echo "To update later, just run this installer again."
