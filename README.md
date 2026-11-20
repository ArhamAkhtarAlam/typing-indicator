# typing-indicator 🐱

A Vencord plugin (**TypingVerbs**) that turns **"Alex is typing..."** into **"Alex is meowing..."**. Everyone picks their own verb, and a shared server syncs them, so everyone running the plugin sees everyone else's verb.

```
Alice and Bob are meowing, Carol is barking...
```

People without the plugin see the normal "is typing".

## Install

You need [Node.js 22+](https://nodejs.org) and [git](https://git-scm.com). The installer sets up a Vencord source build if you don't have one (custom plugins need one), adds the plugin, builds everything, and patches Discord.

**macOS / Linux** (in Terminal):

```bash
curl -fsSL https://raw.githubusercontent.com/ArhamAkhtarAlam/typing-indicator/main/install.sh | bash
```

**Windows** (in PowerShell):

```powershell
irm https://raw.githubusercontent.com/ArhamAkhtarAlam/typing-indicator/main/install.ps1 | iex
```

Then:

1. Fully quit Discord and reopen it.
2. **Settings → Vencord → Plugins**: turn **off** `TypingTweaks` (it clashes) and turn **on** `TypingVerbs`.
3. Click the cog next to TypingVerbs and type your verb, e.g. `meowing`.

To update, run the installer again. Vencord lives in `~/Vencord`; set `VENCORD_DIR` to use a different folder. Vesktop users: run with `SKIP_INJECT=1`, then set Vesktop's *Vencord Location* to `~/Vencord/dist`.

### Settings

| Setting | What it does |
|---|---|
| Verb | Your verb (empty = normal "typing") |
| Server URL | The sync server. Leave it as is to share verbs with everyone else using the default. |
| Fallback verb | What *you* see for people without a verb (set it to `meowing` to make everyone a cat) |
| Role colors | Colour names by their role colour |

## Bonus plugin: ValorantDND

Turns on **Do Not Disturb** only while VALORANT is running, then puts your old status back when you close it. Other games don't trigger it. (Vencord's built-in AutoDNDWhilePlaying fires for *every* game.)

To install only this one, on Windows (PowerShell):

```powershell
$env:PLUGINS="valorantDnd"; irm https://raw.githubusercontent.com/ArhamAkhtarAlam/typing-indicator/main/install.ps1 | iex
```

macOS / Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/ArhamAkhtarAlam/typing-indicator/main/install.sh | PLUGINS=valorantDnd bash
```

Then turn on **ValorantDND** in Settings → Vencord → Plugins, and turn off **AutoDNDWhilePlaying** if it's on. In its settings you can add more games (comma-separated, e.g. `VALORANT, Counter-Strike 2`) or pick Idle/Invisible instead of DND. If you change your status by hand mid-game, it leaves your choice alone. Discord has to detect the game, so check that VALORANT appears under Settings → Registered Games.

## Keeping it working after Discord updates (Windows)

Discord updates remove Vencord. `tools/discord_plugins.py` checks every day and when you log in, pops up a message if something broke, and puts a **Fix Discord** button on your desktop. The fix updates Vencord and your plugins, rebuilds, puts Vencord back into Discord and restarts it. If an update breaks the build or one of the plugins you use, it goes back to the last versions that worked.

You need [Python 3](https://www.python.org/downloads/) (tick "Add python.exe to PATH" when installing). Then in PowerShell:

```powershell
irm https://raw.githubusercontent.com/ArhamAkhtarAlam/typing-indicator/main/tools/discord_plugins.py -OutFile "$env:TEMP\discord_plugins.py"; py "$env:TEMP\discord_plugins.py" setup
```

Run that once your plugins are switched on the way you like. It remembers which ones you use. Afterwards, whenever Discord updates, double-click **Fix Discord** on your desktop.

Other commands (`py "$env:LOCALAPPDATA\discord-plugins\discord_plugins.py" <command>`): `status`, `check`, `fix`, `save` (remember plugins you switched on since), `remove` (stop the daily check).

## How it works

* The plugin hooks Discord's typing indicator, using the same patch as Vencord's built-in TypingTweaks. When someone starts typing, it asks the server for their verb (batched, cached for 5 minutes) and redraws the text.
* Requests go through the plugin's `native.ts`, which runs on Discord's Node side, so Discord's Content Security Policy doesn't block them.
* **Account claims:** the first time you set a verb, the server gives your client a secret token (kept in the plugin settings). After that, only that token can change your verb. It's first-come-first-served, so if you reinstall and lose the token, ask the server owner to reset you.
* Verbs are 1–32 letters, numbers, spaces and `'-!?~.`.

## Running your own server

`server/typing_verbs_server.py` uses only the Python 3 standard library. It stores verbs in SQLite.

```bash
python3 server/typing_verbs_server.py --port 8787
```

See `server/typing-verbs.service` for running it as a systemd user service. To expose it, put any HTTPS reverse proxy in front, e.g. Tailscale Funnel:

```bash
sudo tailscale funnel --bg --https=443 --set-path=/typing-verbs http://127.0.0.1:8787
```

Then point the plugin's **Server URL** at it.

Admin commands:

```bash
python3 typing_verbs_server.py --list              # who has which verb
python3 typing_verbs_server.py --reset <userId>    # free up someone's account
```

API: `GET /v1/verbs?ids=1,2,3` → `{"verbs": {...}}`, `POST /v1/verb {userId, verb, token?}`, `GET /health`.
