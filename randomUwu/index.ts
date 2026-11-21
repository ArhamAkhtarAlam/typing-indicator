/*
 * RandomUwU: every message you send has a small chance of getting uwuified.
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";

const settings = definePluginSettings({
    chance: {
        type: OptionType.NUMBER,
        description: "Chance (in %) that a message gets uwuified",
        default: 1,
    },
    faces: {
        type: OptionType.BOOLEAN,
        description: "Add a face like owo or >w< at the end",
        default: true,
    },
});

const FACES = ["owo", "uwu", ">w<", "^w^", "OwO", "UwU", ":3", "x3", "(˘ω˘)", "(⁄˘⁄ ⁄ ω⁄ ⁄ ˘⁄)♡"];
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

// links, code, mentions, custom emojis, :emoji: and timestamps stay untouched
const KEEP = /(```[\s\S]*?```|`[^`]*`|https?:\/\/\S+|<[^>\s]+>|:[\w~-]+:)/;

function uwuText(t: string) {
    return t
        .replace(/[rl]/g, "w")
        .replace(/[RL]/g, "W")
        .replace(/n([aeiou])/g, "ny$1")
        .replace(/N([aeiou])/g, "Ny$1")
        .replace(/N([AEIOU])/g, "NY$1")
        .replace(/ove\b/g, "uv")
        .replace(/\bth/g, "d")
        .replace(/\bTh/g, "D")
        // s-s-stutter on some words
        .replace(/\b([a-zA-Z])(\w{2,})/g, (m, a, b) => Math.random() < 0.15 ? `${a}-${a}${b}` : m);
}

export function uwuify(msg: string) {
    const out = msg.split(KEEP).map((part, i) => i % 2 ? part : uwuText(part)).join("");
    return settings.store.faces ? `${out.trimEnd()} ${pick(FACES)}` : out;
}

export default definePlugin({
    name: "RandomUwU",
    description: "Every message you send has a 1% chance (changeable) of getting uwuified",
    authors: [{ name: "Arham", id: 0n }],
    settings,

    onBeforeMessageSend(_, msg) {
        if (!msg.content.trim() || msg.content.startsWith("/")) return;
        if (Math.random() * 100 < settings.store.chance) {
            msg.content = uwuify(msg.content);
        }
    },
});
