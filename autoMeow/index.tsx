/*
 * AutoMeow: a paw button in the chat bar. Every click sends a meow (or mrow, maiw, mrrrp, nya...).
 */

import { ChatBarButton } from "@api/ChatButtons";
import { definePluginSettings } from "@api/Settings";
import { sendMessage } from "@utils/discord";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore } from "@webpack/common";

const DEFAULT_MEOWS = "meow, mew, miau, maio, mrow, meiw, maiw, meuw, miaw, mraow, mreow, meo, mjau, miao, mau, mrrow, mewo, maow, miu, mewww, meowr";
const DEFAULT_RARE = "mrrrp, mrrp, mrp?, prrrt, purrr, nya, nya~, nyaa, nyan, mrrrow, brrrp, prrrp?, :3, nyaaa~, mrrrrp :3, *purrs*, *headbutts you*";

const settings = definePluginSettings({
    meows: {
        type: OptionType.STRING,
        description: "Normal meows, separated by commas. Add your own variations!",
        default: DEFAULT_MEOWS,
    },
    rare: {
        type: OptionType.STRING,
        description: "Rare ones (mrrrp, nya, purrs...), separated by commas",
        default: DEFAULT_RARE,
    },
    stretch: {
        type: OptionType.BOOLEAN,
        description: "Randomly stretch, shout and decorate them (meeeow, MEOW, mrow~)",
        default: true,
    },
    rareChance: {
        type: OptionType.NUMBER,
        description: "Chance (in %) of a rare one like mrrrp or nya instead of a meow",
        default: 15,
    },
});

// ---------- meow generator ----------
const rand = (n: number) => Math.floor(Math.random() * n);
const pick = <T,>(a: T[]) => a[rand(a.length)];
const chance = (p: number) => Math.random() < p;


// your lists from the settings (comma-separated), or the defaults if you emptied one
const list = (txt: string, fallback: string) =>
    (txt.split(",").map(w => w.trim()).filter(Boolean).length ? txt : fallback)
        .split(",").map(w => w.trim()).filter(Boolean);

// stretch one letter: meow -> meeeow, mrrp -> mrrrrrp
function stretch(w: string) {
    const spots = [...w].map((c, i) => "aeiouyr".includes(c) ? i : -1).filter(i => i >= 0);
    if (!spots.length) return w;
    const i = pick(spots);
    return w.slice(0, i) + w[i].repeat(2 + rand(4)) + w.slice(i + 1);
}

export function meow() {
    const rare = chance(settings.store.rareChance / 100);
    const MEOWS = list(settings.store.meows, DEFAULT_MEOWS);
    const RARE = list(settings.store.rare, DEFAULT_RARE);
    let w = rare && RARE.length ? pick(RARE) : pick(MEOWS);
    const fx = settings.store.stretch;
    if (fx && chance(0.35)) w = stretch(w);
    if (fx && !rare && chance(0.2)) w = `${w} ${pick(MEOWS)}`;        // meow mrow
    if (fx && chance(0.12)) w = w.toUpperCase();                       // MEOW
    if (fx && chance(0.3)) w += pick(["~", "!", "?", " :3", "!!", "~~", " >w<"]);
    return w;
}

// ---------- button ----------
function PawIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <ellipse cx="6" cy="9" rx="2.2" ry="2.8" />
            <ellipse cx="10" cy="5.5" rx="2.2" ry="2.8" />
            <ellipse cx="14" cy="5.5" rx="2.2" ry="2.8" />
            <ellipse cx="18" cy="9" rx="2.2" ry="2.8" />
            <path d="M12 11c-3 0-6.5 4.2-6.5 7 0 1.8 1.4 2.6 3 2.6 1.5 0 2.3-.8 3.5-.8s2 .8 3.5.8c1.6 0 3-.8 3-2.6 0-2.8-3.5-7-6.5-7z" />
        </svg>
    );
}

export default definePlugin({
    name: "AutoMeow",
    description: "Adds a paw button to the chat bar: every click sends a meow (meow, mrow, maiw, meuw, mrrrp, nya...)",
    authors: [{ name: "Arham", id: 0n }],
    settings,

    chatBarButton: {
        icon: PawIcon,
        render: ({ channel, isMainChat }) => {
            if (!isMainChat || !ChannelStore.getChannel(channel.id)) return null;
            return (
                <ChatBarButton tooltip="Meow" onClick={() => sendMessage(channel.id, { content: meow() })}>
                    <PawIcon />
                </ChatBarButton>
            );
        },
    },
});
