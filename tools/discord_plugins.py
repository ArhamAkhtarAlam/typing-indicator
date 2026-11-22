#!/usr/bin/env python3
"""
Keeps a Vencord source install (the one install.ps1 sets up) and its plugins working on Windows.

    python discord_plugins.py setup    save your current plugins, check daily + at login, add "Fix Discord" to the desktop
    python discord_plugins.py check    see if everything still works (pops up a message if not)
    python discord_plugins.py fix      update + rebuild + put Vencord back into Discord, restart Discord
    python discord_plugins.py status   list the plugins it's looking after and whether they work
    python discord_plugins.py save     save what you have switched on right now
    python discord_plugins.py remove   stop the daily check

"fix" goes back to the last versions that worked if an update breaks the build or one of your plugins.
Needs: git, Node.js 22+, Python 3.9+. Only uses the standard library.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path

HOME = Path.home()
VC_DIR = Path(os.environ.get("VENCORD_DIR", HOME / "Vencord"))
APPDATA = Path(os.environ.get("APPDATA", HOME / "AppData" / "Roaming"))
LOCALAPPDATA = Path(os.environ.get("LOCALAPPDATA", HOME / "AppData" / "Local"))
SETTINGS = Path(os.environ.get("VENCORD_SETTINGS", APPDATA / "Vencord" / "settings" / "settings.json"))
STATE = Path(os.environ.get("DISCORD_PLUGINS_STATE", LOCALAPPDATA / "discord-plugins"))
DISCORD_DIRS = [LOCALAPPDATA / n for n in ("Discord", "DiscordPTB", "DiscordCanary")]
if os.environ.get("DISCORD_DIR"):
    DISCORD_DIRS = [Path(os.environ["DISCORD_DIR"])]
UP = VC_DIR / "src" / "userplugins"
RENDERER = VC_DIR / "dist" / "renderer.js"
PLUGIN_REPO = "https://github.com/ArhamAkhtarAlam/typing-indicator.git"
REPO_PLUGINS = ["typingVerbs", "valorantDnd", "randomUwu", "autoMeow"]
RETIRED_PLUGINS = ["noChillZone", "meowTranslator"]  # removed from the repo: deleted from your install too
TASK = "DiscordPluginCheck"
IS_WIN = os.name == "nt"
NO_WINDOW = 0x08000000 if IS_WIN else 0


# ---------- small helpers ----------

def say(msg):
    print(f"==> {msg}", flush=True)


def warn(msg):
    print(f"!! {msg}", flush=True)


class Fail(Exception):
    pass


def run(cmd, cwd=None, check=True, quiet=False):
    """run a command; .cmd shims (pnpm.cmd, npx.cmd) go through cmd /c"""
    if IS_WIN and str(cmd[0]).lower().endswith((".cmd", ".bat")):
        cmd = ["cmd", "/c"] + [str(c) for c in cmd]
    r = subprocess.run([str(c) for c in cmd], cwd=cwd, text=True,
                       capture_output=quiet, creationflags=NO_WINDOW if quiet else 0)
    if check and r.returncode != 0:
        if quiet:
            print((r.stdout or "")[-3000:], (r.stderr or "")[-3000:])
        raise Fail(f"'{' '.join(map(str, cmd))}' failed")
    return r


def git(*args, cwd=VC_DIR, check=True):
    return run(["git", *args], cwd=cwd, check=check, quiet=True)


def pnpm(*args, quiet=False):
    for name in ("pnpm.cmd", "pnpm") if IS_WIN else ("pnpm",):
        exe = shutil.which(name)
        if exe:
            return run([exe, *args], cwd=VC_DIR, quiet=quiet)
    npx = shutil.which("npx.cmd" if IS_WIN else "npx") or "npx"
    return run([npx, "--yes", "pnpm", *args], cwd=VC_DIR, quiet=quiet)


def popup(text, title="Discord plugins"):
    print(text)
    if IS_WIN:
        import ctypes
        ctypes.windll.user32.MessageBoxW(None, text, title, 0x40 | 0x40000)  # info icon, on top


# ---------- what's installed / working ----------

def build_has(names):
    if not RENDERER.exists():
        return set()
    js = RENDERER.read_text(encoding="utf-8", errors="ignore")
    return {n for n in names if f'name:"{n}"' in js}


def enabled_plugins():
    try:
        s = json.loads(SETTINGS.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return set()
    return {n for n, c in s.get("plugins", {}).items() if isinstance(c, dict) and c.get("enabled")}


def working_enabled():
    return build_has(enabled_plugins())


def saved_plugins():
    f = STATE / "plugins.txt"
    return set(f.read_text().split()) if f.exists() else set()


def missing_plugins():
    saved = saved_plugins()
    return sorted(saved - build_has(saved))


def discord_installs():
    """(install dir, newest app-x.y.z resources folder) for each Discord that's installed"""
    out = []
    for d in DISCORD_DIRS:
        apps = sorted(d.glob("app-*"), key=lambda p: [int(x) if x.isdigit() else 0
                                                       for x in re.split(r"[.-]", p.name[4:])])
        if apps:
            out.append((d, apps[-1] / "resources"))
    return out


def is_patched(resources: Path):
    """does this Discord load our Vencord build?"""
    target = os.path.normcase(os.path.realpath(VC_DIR / "dist" / "patcher.js"))
    for f in (resources / "app.asar", resources / "app" / "index.js"):
        try:
            data = f.read_bytes()
        except OSError:
            continue
        for m in re.finditer(rb'require\("((?:[^"\\]|\\.)*patcher\.js)"\)', data):
            p = m.group(1).decode("utf-8", "ignore").replace("\\\\", "\\")
            if os.path.normcase(os.path.realpath(p)) == target:
                return True
    return False


def problems():
    found = []
    installs = discord_installs()
    if not installs:
        found.append("Couldn't find Discord.")
    unpatched = [d.name for d, res in installs if not is_patched(res)]
    if unpatched:
        found.append(f"Discord updated and Vencord isn't loaded any more ({', '.join(unpatched)}).")
    if not RENDERER.exists():
        found.append("There's no Vencord build.")
    else:
        m = missing_plugins()
        if m:
            found.append("These plugins aren't in the build: " + ", ".join(m))
    return found


# ---------- saving / restoring ----------

def own_plugin_dirs():
    if not UP.exists():
        return []
    ported = UP / ".equicord-ported"  # plugins copied in from Equicord are rebuilt, not backed up
    skip = set(ported.read_text().split()) if ported.exists() else set()
    return [p for p in UP.iterdir() if not p.name.startswith((".", "_")) and p.name not in skip]


def save_state():
    STATE.mkdir(parents=True, exist_ok=True)
    (STATE / "plugins.txt").write_text("\n".join(sorted(working_enabled())) + "\n")
    (STATE / "vencord.commit").write_text(git("rev-parse", "HEAD").stdout.strip())
    new = STATE / "userplugins.new"
    shutil.rmtree(new, ignore_errors=True)
    new.mkdir()
    for p in own_plugin_dirs():
        (shutil.copytree if p.is_dir() else shutil.copy2)(p, new / p.name)
    shutil.rmtree(STATE / "userplugins", ignore_errors=True)
    new.rename(STATE / "userplugins")


def restore_own_plugins():
    saved = STATE / "userplugins"
    if not saved.exists():
        return
    for p in saved.iterdir():
        if p.name in RETIRED_PLUGINS:
            continue
        dest = UP / p.name
        if dest.is_dir():
            rmtree(dest)
        elif dest.exists():
            dest.unlink()
        (shutil.copytree if p.is_dir() else shutil.copy2)(p, dest)


def _force_remove(func, path, _):
    os.chmod(path, 0o666)  # git makes some files read-only on Windows
    func(path)


def rmtree(p):
    if sys.version_info >= (3, 12):
        shutil.rmtree(p, onexc=_force_remove)
    else:
        shutil.rmtree(p, onerror=_force_remove)


def backup_settings():
    if not SETTINGS.exists():
        return
    b = STATE / "settings-backups"
    b.mkdir(parents=True, exist_ok=True)
    shutil.copy2(SETTINGS, b / f"settings-{datetime.now():%Y%m%d-%H%M%S}.json")
    for old in sorted(b.glob("*.json"))[:-10]:
        old.unlink()


def goto_commit(commit):
    if git("reset", "--hard", "--quiet", commit, check=False).returncode != 0:
        git("fetch", "--quiet", "--depth", "1", "origin", commit)
        git("reset", "--hard", "--quiet", commit)


# ---------- updating ----------

def update_sources():
    say("Updating Vencord")
    if git("pull", "--ff-only", "--quiet", check=False).returncode != 0:
        print("   (couldn't update, building what's there)")

    for p in RETIRED_PLUGINS:
        if (UP / p).exists():
            say(f"Removing {p} (taken down or merged into another plugin)")
            rmtree(UP / p)
        if (STATE / "userplugins" / p).exists():
            rmtree(STATE / "userplugins" / p)

    have = [p for p in REPO_PLUGINS if (UP / p).exists()]
    if have:
        say(f"Updating {', '.join(have)}")
        with tempfile.TemporaryDirectory() as tmp:
            if run(["git", "clone", "--quiet", "--depth", "1", PLUGIN_REPO, f"{tmp}/repo"],
                   check=False, quiet=True).returncode == 0:
                repo = Path(tmp) / "repo"
                for p in have:
                    if not (repo / p).exists():
                        continue  # no longer in the repo: keep what you have
                    rmtree(UP / p)
                    shutil.copytree(repo / p, UP / p)
                # keep this script itself up to date for next time
                new_script = repo / "tools" / "discord_plugins.py"
                saved = STATE / "discord_plugins.py"
                if new_script.exists() and saved.exists():
                    shutil.copy2(new_script, saved)
            else:
                print("   (couldn't download them, keeping the ones you have)")

    # other plugins cloned from GitHub: pull updates, keep local edits
    for d in own_plugin_dirs():
        if not (d / ".git").exists() or git("rev-parse", "@{u}", cwd=d, check=False).returncode != 0:
            continue
        if git("fetch", "--quiet", cwd=d, check=False).returncode != 0:
            print(f"   {d.name}: couldn't check for updates")
            continue
        old = git("rev-parse", "HEAD", cwd=d).stdout.strip()
        if git("merge-base", "--is-ancestor", "@{u}", "HEAD", cwd=d, check=False).returncode == 0:
            print(f"   {d.name}: up to date")
            continue
        say(f"Updating {d.name}")
        stashed = bool(git("status", "--porcelain", cwd=d).stdout.strip()) and \
            git("stash", "push", "--include-untracked", "--quiet", cwd=d, check=False).returncode == 0
        if git("merge", "--ff-only", "--quiet", "@{u}", cwd=d, check=False).returncode != 0:
            print(f"   {d.name}: couldn't update cleanly, keeping your version")
            git("reset", "--hard", "--quiet", old, cwd=d)
        elif stashed and git("stash", "pop", "--quiet", cwd=d, check=False).returncode != 0:
            print(f"   {d.name}: the update clashes with your own changes, keeping your old version")
            git("reset", "--hard", "--quiet", old, cwd=d)
            git("clean", "-fdq", cwd=d)
        else:
            stashed = False
        if stashed:
            git("stash", "pop", "--quiet", cwd=d)


def build():
    say("Installing dependencies")
    try:
        pnpm("install", "--frozen-lockfile", quiet=True)
    except Fail:
        pnpm("install", quiet=True)
    say("Building")
    pnpm("build", quiet=True)


def close_discord():
    if IS_WIN:
        for exe in ("Discord.exe", "DiscordPTB.exe", "DiscordCanary.exe"):
            subprocess.run(["taskkill", "/F", "/IM", exe], capture_output=True)
    time.sleep(3)


def start_discord():
    if not IS_WIN:
        return
    for d, _ in discord_installs():
        exe = {"Discord": "Discord.exe", "DiscordPTB": "DiscordPTB.exe",
               "DiscordCanary": "DiscordCanary.exe"}.get(d.name, "Discord.exe")
        upd = d / "Update.exe"
        if upd.exists():
            subprocess.Popen([str(upd), "--processStart", exe], creationflags=NO_WINDOW)
            return


def patch_discord():
    for d, res in discord_installs():
        if is_patched(res):
            continue
        say(f"Putting Vencord back into {d.name}")
        close_discord()
        run(["node", "scripts/runInstaller.mjs", "--", "--install", "--location", str(d)], cwd=VC_DIR)
        if not is_patched(res):
            raise Fail(f"Vencord still isn't in {d.name}. Fully quit Discord (system tray -> Quit) and run Fix Discord again.")


def fix():
    if not (VC_DIR / ".git").exists():
        raise Fail(f"No Vencord found at {VC_DIR}. Run the typing-indicator installer first.")
    if not saved_plugins() and RENDERER.exists():
        say("Saving your current setup first")
        save_state()
    # also remember plugins switched on since the last save
    (STATE / "plugins.txt").write_text("\n".join(sorted(saved_plugins() | working_enabled())) + "\n")
    backup_settings()

    update_sources()
    rolled_back = False
    try:
        build()
    except Fail:
        commit_file = STATE / "vencord.commit"
        if not commit_file.exists():
            raise Fail("The build failed and there's no saved working version to go back to.")
        warn("The new versions don't build. Going back to the last versions that worked.")
        goto_commit(commit_file.read_text().strip())
        restore_own_plugins()
        build()
        rolled_back = True

    m = missing_plugins()
    if m and (STATE / "userplugins").exists():
        warn("Some of your plugins stopped working: " + ", ".join(m))
        warn("Trying the last working copies of your own plugins")
        restore_own_plugins()
        build()
        m = missing_plugins()
    if m:
        warn("Still not working (probably needs a fix from the plugin's author; your settings are kept): "
             + ", ".join(m))
    elif not rolled_back:
        save_state()

    patch_discord()
    say("Restarting Discord")
    close_discord()
    start_discord()
    if m:
        print("\nDone, but some plugins are missing (see above).")
    else:
        print(f"\nDone! All {len(saved_plugins())} plugins you use are working.")


def remember_new_plugins():
    """plugins switched on since the last save (and working now) get looked after too"""
    if not RENDERER.exists() or not (STATE / "plugins.txt").exists():
        return
    new = working_enabled() - saved_plugins()
    if new:
        (STATE / "plugins.txt").write_text("\n".join(sorted(saved_plugins() | new)) + "\n")


# ---------- scheduling ----------

def setup():
    if not RENDERER.exists():
        raise Fail("No Vencord build found. Run the typing-indicator installer first.")
    save_state()
    say(f"Saved {len(saved_plugins())} plugins you have switched on")
    me = Path(__file__).resolve()
    keep = STATE / "discord_plugins.py"
    if me != keep:
        shutil.copy2(me, keep)  # keep a copy in a stable place for the scheduled task
    if not IS_WIN:
        print("(scheduling + desktop shortcut are Windows-only, skipped)")
        return
    pyw = Path(sys.executable).with_name("pythonw.exe")
    py = pyw if pyw.exists() else Path(sys.executable)
    run(["schtasks", "/Create", "/F", "/SC", "DAILY", "/ST", "18:00", "/TN", TASK,
         "/TR", f'"{py}" "{keep}" check'], quiet=True)
    startup = APPDATA / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Startup"
    (startup / "Discord plugin check.bat").write_text(
        f'@start "" "{py}" "{keep}" check --wait 120\r\n')
    desktop = HOME / "Desktop"
    if not desktop.exists():
        desktop = HOME / "OneDrive" / "Desktop"
    (desktop / "Fix Discord.bat").write_text(
        f'@echo off\r\n"{Path(sys.executable)}" "{keep}" fix\r\necho.\r\npause\r\n')
    say("Checks every day at 6pm and a couple of minutes after you log in")
    say(f"If Discord updates, double-click 'Fix Discord' on your desktop")


def remove():
    if IS_WIN:
        subprocess.run(["schtasks", "/Delete", "/F", "/TN", TASK], capture_output=True)
        (APPDATA / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Startup" /
         "Discord plugin check.bat").unlink(missing_ok=True)
    say("Stopped the daily check (the 'Fix Discord' shortcut still works)")


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    try:
        if cmd == "setup":
            setup()
        elif cmd == "check":
            if "--wait" in sys.argv:
                time.sleep(int(sys.argv[sys.argv.index("--wait") + 1]))
            remember_new_plugins()
            p = problems()
            if p:
                popup("\n".join(p) + "\n\nDouble-click 'Fix Discord' on your desktop to put it all back.",
                      "Discord plugins need fixing")
            else:
                print(f"All good: Vencord is loaded and all {len(saved_plugins())} plugins are working.")
        elif cmd == "fix":
            fix()
        elif cmd == "save":
            save_state()
            say(f"Saved {len(saved_plugins())} plugins you have switched on")
        elif cmd == "status":
            print(f"Looking after {len(saved_plugins())} plugins: {', '.join(sorted(saved_plugins())) or '(none saved)'}")
            p = problems()
            print("\n".join(p) if p else "Everything is working.")
            new = working_enabled() - saved_plugins()
            if new:
                print("Switched on since the last save (run 'save' to keep them): " + ", ".join(sorted(new)))
        elif cmd == "remove":
            remove()
        else:
            print(__doc__)
            return 1
    except Fail as e:
        warn(str(e))
        if cmd == "check":
            popup(str(e), "Discord plugins")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
