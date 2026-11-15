/*
 * ValorantDND, a Vencord user plugin
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Like Vencord's built-in AutoDNDWhilePlaying, but only for the games you list
 * (VALORANT by default). Your previous status comes back when the game closes.
 *
 * Needs Discord's game detection: Settings → Activity Privacy → "Share your
 * detected activities with others" (or Registered Games showing VALORANT).
 */

import { definePluginSettings } from "@api/Settings";
import { getUserSettingLazy } from "@api/UserSettings";
import definePlugin, { OptionType } from "@utils/types";
import { RunningGameStore, UserSettingsProtoStore } from "@webpack/common";

const StatusSettings = getUserSettingLazy<string>("status", "status")!;

const settings = definePluginSettings({
    games: {
        type: OptionType.STRING,
        description: "Games that turn on the status, separated by commas (game name or .exe name)",
        default: "VALORANT",
        onChange: () => check(RunningGameStore.getRunningGames())
    },
    statusToSet: {
        type: OptionType.SELECT,
        description: "Status to set while one of those games is running",
        options: [
            { label: "Do Not Disturb", value: "dnd", default: true },
            { label: "Idle", value: "idle" },
            { label: "Invisible", value: "invisible" }
        ]
    }
});

interface Game { name?: string; exeName?: string; exePath?: string; }

/** status to go back to when the game closes; null = we didn't change anything */
let savedStatus: string | null = null;
/** last status we set ourselves, so we can tell when the user changes it by hand */
let lastStatus: string | null = null;

function wanted() {
    return settings.store.games
        .split(",")
        .map(s => s.trim().toLowerCase().replace(/\.exe$/, ""))
        .filter(Boolean);
}

function matches(game: Game, list: string[]) {
    const exe = (game.exeName || game.exePath?.split(/[\\/]/).pop() || "").toLowerCase().replace(/\.exe$/, "");
    const name = (game.name || "").toLowerCase();
    // VALORANT's real process is "VALORANT-Win64-Shipping.exe", so also match exe names that start with an entry
    return list.some(w => name === w || exe === w || exe.startsWith(w + "-"));
}

async function setStatus(status: string) {
    lastStatus = status;
    await StatusSettings.updateSetting(status);
}

async function check(games: Game[] = []) {
    const list = wanted();
    const playing = games.some(g => matches(g, list));
    const current = StatusSettings.getSetting();
    const target = settings.store.statusToSet;

    if (playing) {
        // don't touch it if you're already on that status (or deliberately invisible)
        if (savedStatus === null && current !== target && current !== "invisible") {
            savedStatus = current;
            await setStatus(target);
        }
    } else if (savedStatus !== null) {
        const restore = savedStatus;
        savedStatus = null;
        if (current !== restore) await setStatus(restore);
    }
}

function onSettingsChange() {
    const status = StatusSettings.getSetting();
    if (status !== lastStatus) {
        // you changed your status by hand while playing → keep it, don't restore later
        lastStatus = status;
        savedStatus = null;
    }
}

export default definePlugin({
    name: "ValorantDND",
    description: "Turns on Do Not Disturb only while you're playing VALORANT (or other games you pick), then puts your status back",
    authors: [{ name: "typing-indicator", id: 0n }],
    settings,

    flux: {
        RUNNING_GAMES_CHANGE({ games }: { games: Game[]; }) {
            check(games);
        }
    },

    start() {
        lastStatus = StatusSettings.getSetting();
        UserSettingsProtoStore.addChangeListener(onSettingsChange);
        check(RunningGameStore.getRunningGames());
    },

    stop() {
        UserSettingsProtoStore.removeChangeListener(onSettingsChange);
        if (savedStatus !== null) {
            const restore = savedStatus;
            savedStatus = null;
            setStatus(restore);
        }
    }
});
