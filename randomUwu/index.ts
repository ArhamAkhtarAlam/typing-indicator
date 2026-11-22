/*
 * RandomUwU: every message you send has a small chance of getting uwuified.
 * Optional (off by default): when a friend says !uwu, your next message gets uwuified, no escape.
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { Message } from "@vencord/discord-types";
import { showToast, UserStore } from "@webpack/common";

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
    friendTrigger: {
        type: OptionType.BOOLEAN,
        description: "Let friends type !uwu to force your next message to be uwuified (you can't stop it)",
        default: false,
    },
    triggerUsers: {
        type: OptionType.STRING,
        description: "Only these people can use !uwu (user IDs, comma-separated). Empty = anyone",
        default: "",
    },
});

// set when someone says !uwu: your next message is doomed
let doomedBy: string | null = null;

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
    description: "Every message you send has a 1% chance (changeable) of getting uwuified. Optional: friends can say !uwu to uwuify your next message",
    authors: [{ name: "Arham", id: 0n }],
    settings,

    onBeforeMessageSend(_, msg) {
        if (!msg.content.trim() || msg.content.startsWith("/")) return;
        if (doomedBy) {
            doomedBy = null;
            msg.content = uwuify(msg.content);
        } else if (Math.random() * 100 < settings.store.chance) {
            msg.content = uwuify(msg.content);
        }
    },

    flux: {
        MESSAGE_CREATE({ message, optimistic }: { message: Message; optimistic: boolean; }) {
            if (optimistic || !settings.store.friendTrigger) return;
            if (!/^\s*!uwu\b/i.test(message.content ?? "")) return;
            const author = message.author;
            const me = UserStore.getCurrentUser()?.id;
            if (!author || author.id === me) return;
            const allowed = settings.store.triggerUsers.split(/[\s,]+/).filter(Boolean);
            if (allowed.length && !allowed.includes(author.id)) return;
            if (doomedBy) return;
            doomedBy = author.id;
            const name = (author as any).globalName || author.username;
            showToast({ text: `${name} said !uwu. Your next message will be uwuified >w<` });
        },
    },
});
