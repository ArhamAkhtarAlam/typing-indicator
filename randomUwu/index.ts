/*
 * RandomUwU: every message you send has a small chance of getting uwuified.
 * Optional (off by default): when a friend says !uwu (in servers: !uwu @you), your next message in
 * that channel gets uwuified, no escape.
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { Message } from "@vencord/discord-types";
import { ChannelStore, UserStore } from "@webpack/common";

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
    maxStack: {
        type: OptionType.NUMBER,
        description: "Each !uwu adds one more uwuified message (stacking). Most that can pile up per channel (0 = no limit)",
        default: 5,
    },
    dodgeChance: {
        type: OptionType.NUMBER,
        description: "Send !dodge to try to clear the traps in a channel. Chance (in %) it works; if it fails you get one more trap",
        default: 30,
    },
    level: {
        type: OptionType.SELECT,
        description: "How uwu the random 1% messages get",
        options: [
            { label: "Light (hewwo)", value: "light" },
            { label: "Medium (h-hewwo, dis is nyice)", value: "medium", default: true },
            { label: "Extreme (H-h-hewwo OwO *nuzzles*)", value: "extreme" },
        ],
    },
    trapLevel: {
        type: OptionType.SELECT,
        description: "How uwu your message gets when someone !uwu's you",
        options: [
            { label: "Light", value: "light" },
            { label: "Medium", value: "medium" },
            { label: "Extreme", value: "extreme", default: true },
        ],
    },
});

type Level = "light" | "medium" | "extreme";

// channel id -> how many of your next messages there are doomed (each !uwu adds one)
const traps = new Map<string, number>();

const FACES = ["owo", "uwu", ">w<", "^w^", "OwO", "UwU", ":3", "x3", "(˘ω˘)", "(⁄˘⁄ ⁄ ω⁄ ⁄ ˘⁄)♡"];
const ACTIONS = ["*nuzzles*", "*blushes*", "*pounces on you*", "*wags tail*", "*stares at you*",
    "*hides face*", "*giggles*", "*boops your nose*", "*rolls around*", "*sweats*", "*purrs*", "*huggles you*"];
const WORDS: Record<string, string> = {
    you: "yuw", your: "yuw", what: "wat", small: "smol", cat: "kitty", cute: "kawaii", hi: "hai",
    hello: "hewwo", love: "wuv", sorry: "sowwy", please: "pwease", stop: "stawp", no: "nu", oh: "ohh",
};
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const chance = (p: number) => Math.random() < p;

// links, code, mentions, custom emojis, :emoji: and timestamps stay untouched
const KEEP = /(```[\s\S]*?```|`[^`]*`|https?:\/\/\S+|<[^>\s]+>|:[\w~-]+:)/;

const matchCase = (orig: string, w: string) =>
    orig === orig.toUpperCase() && orig.length > 1 ? w.toUpperCase() : orig[0] === orig[0].toUpperCase() ? w[0].toUpperCase() + w.slice(1) : w;

function uwuText(t: string, level: Level) {
    if (level === "extreme") {
        t = t.replace(/\b[a-zA-Z]+\b/g, w => WORDS[w.toLowerCase()] ? matchCase(w, WORDS[w.toLowerCase()]) : w);
    }
    t = t
        .replace(/[rl]/g, "w")
        .replace(/[RL]/g, "W")
        .replace(/n([aeiou])/g, "ny$1")
        .replace(/N([aeiou])/g, "Ny$1")
        .replace(/N([AEIOU])/g, "NY$1");
    if (level === "light") return t;

    t = t
        .replace(/ove\b/g, "uv")
        .replace(/\bth/g, "d")
        .replace(/\bTh/g, "D");
    const stutter = level === "extreme" ? 0.35 : 0.15;
    t = t.replace(/\b([a-zA-Z])(\w{2,})/g, (m, a, b) => chance(stutter) ? `${a}-${a}${b}` : m);
    if (level === "medium") return t;

    // extreme: faces and actions after sentences, extra excitement
    return t
        .replace(/!+/g, () => pick(["!!", "!!1!", "!! >w<", "!!!"]))
        .replace(/([.!?])(\s+|$)/g, (m, p, sp) => chance(0.6) ? `${p} ${chance(0.5) ? pick(FACES) : pick(ACTIONS)}${sp || ""}` : m);
}

export function uwuify(msg: string, level: Level = settings.store.level as Level) {
    let out = msg.split(KEEP).map((part, i) => i % 2 ? part : uwuText(part, level)).join("").trimEnd();
    if (level === "extreme") {
        out = `${pick(ACTIONS)} ${out} ${pick(FACES)}`;
    } else if (settings.store.faces) {
        out = `${out} ${pick(FACES)}`;
    }
    return out;
}

// ---------- !dodge ----------
// a gamble: it might clear every trap in the channel, or it backfires and adds one.
// After any attempt your legs are tired for a random 3-10 minutes, and a dodge in that time always fails.
// The result looks the same whether or not you were actually trapped, so you can't use it to check.
let tiredUntil = 0;
const DODGED = ["*dodges* 🛡️", "*does a backflip and dodges* 🛡️", "*rolls out of the way* 🛡️", "nice try 😼🛡️", "*parries* ⚔️🛡️"];
const TRIPPED = ["*trips and falls*", "*tries to dodge and faceplants*", "*slips on a banana*", "*dodges straight into it*", "*fails the dodge*"];

function dodge(channelId: string, msg: { content: string; }) {
    const now = Date.now();
    const tired = now < tiredUntil;
    tiredUntil = now + (3 + Math.random() * 7) * 60_000;
    if (!tired && Math.random() * 100 < settings.store.dodgeChance) {
        traps.delete(channelId);
        msg.content = pick(DODGED);
    } else {
        const n = traps.get(channelId) ?? 0;
        const max = settings.store.maxStack;
        traps.set(channelId, max > 0 ? Math.min(n + 1, max) : n + 1);
        msg.content = uwuify(pick(TRIPPED), settings.store.trapLevel as Level);
    }
}

export default definePlugin({
    name: "RandomUwU",
    description: "Every message you send has a 1% chance (changeable) of getting uwuified. Optional: friends can say !uwu to uwuify your next message",
    authors: [{ name: "Arham", id: 0n }],
    settings,

    onBeforeMessageSend(channelId, msg) {
        if (!msg.content.trim() || msg.content.startsWith("/")) return;
        if (settings.store.friendTrigger && /^\s*!dodge\s*$/i.test(msg.content)) return dodge(channelId, msg);
        const left = traps.get(channelId) ?? 0;
        if (left > 0) {
            if (left > 1) traps.set(channelId, left - 1);
            else traps.delete(channelId);
            msg.content = uwuify(msg.content, settings.store.trapLevel as Level);
        } else if (Math.random() * 100 < settings.store.chance) {
            msg.content = uwuify(msg.content);
        }
    },

    flux: {
        MESSAGE_CREATE({ message, optimistic }: { message: Message; optimistic: boolean; }) {
            if (optimistic || !settings.store.friendTrigger) return;
            const me = UserStore.getCurrentUser()?.id;
            const author = message.author;
            if (!me || !author || author.id === me) return;
            const content = message.content ?? "";
            // "!uwu", "!uwu @you" or "@you !uwu"
            if (!/^\s*(<@!?\d+>\s*)*!uwu\b/i.test(content)) return;

            // in servers they have to tag you; in DMs and group DMs they don't
            const guildId = (message as any).guild_id ?? ChannelStore.getChannel(message.channel_id)?.guild_id;
            if (guildId) {
                const mentioned = (message.mentions as any[] ?? []).some(u => (typeof u === "string" ? u : u?.id) === me)
                    || content.includes(`<@${me}>`) || content.includes(`<@!${me}>`);
                if (!mentioned) return;
            }

            const allowed = settings.store.triggerUsers.split(/[\s,]+/).filter(Boolean);
            if (allowed.length && !allowed.includes(author.id)) return;
            const now = traps.get(message.channel_id) ?? 0;
            const max = settings.store.maxStack;
            if (max > 0 && now >= max) return;
            traps.set(message.channel_id, now + 1);
        },
    },
});
