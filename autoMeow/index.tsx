/*
 * AutoMeow: a paw button in the chat bar.
 *   click        -> start / stop meowing in this channel every so often
 *   right-click  -> send one meow right now
 */

import { ChatBarButton } from "@api/ChatButtons";
import { definePluginSettings } from "@api/Settings";
import { sendMessage } from "@utils/discord";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, showToast, useEffect, useState } from "@webpack/common";

const settings = definePluginSettings({
    interval: {
        type: OptionType.NUMBER,
        description: "Seconds between meows (randomised a bit, minimum 5)",
        default: 60,
    },
    maxMeows: {
        type: OptionType.NUMBER,
        description: "Stop by itself after this many meows (0 = never)",
        default: 0,
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

const MEOWS = [
    "meow", "mew", "miau", "maio", "mrow", "meiw", "maiw", "meuw", "miaw", "mraow", "mreow",
    "meo", "mjau", "miao", "mau", "meow", "mrrow", "mewo", "maow", "miu", "mewww", "meowr",
];
const RARE = [
    "mrrrp", "mrrp", "mrp?", "prrrt", "purrr", "nya", "nya~", "nyaa", "nyan", "mrrrow",
    "brrrp", "prrrp?", ":3", "nyaaa~", "mrrrrp :3", "*purrs*", "*headbutts you*",
];

// stretch one letter: meow -> meeeow, mrrp -> mrrrrrp
function stretch(w: string) {
    const spots = [...w].map((c, i) => "aeiouyr".includes(c) ? i : -1).filter(i => i >= 0);
    if (!spots.length) return w;
    const i = pick(spots);
    return w.slice(0, i) + w[i].repeat(2 + rand(4)) + w.slice(i + 1);
}

export function meow() {
    const rare = chance(settings.store.rareChance / 100);
    let w = rare ? pick(RARE) : pick(MEOWS);
    if (chance(0.35)) w = stretch(w);
    if (!rare && chance(0.2)) w = `${w} ${pick(MEOWS)}`;        // meow mrow
    if (chance(0.12)) w = w.toUpperCase();                       // MEOW
    if (chance(0.3)) w += pick(["~", "!", "?", " :3", "!!", "~~", " >w<"]);
    return w;
}

// ---------- auto meowing ----------
interface Run { timer: any; sent: number; }
const running = new Map<string, Run>();
const listeners = new Set<() => void>();
const changed = () => listeners.forEach(f => f());

function schedule(channelId: string) {
    const run = running.get(channelId);
    if (!run) return;
    const base = Math.max(5, settings.store.interval) * 1000;
    const delay = base * (0.7 + Math.random() * 0.6);
    run.timer = setTimeout(() => {
        if (!running.has(channelId)) return;
        sendMessage(channelId, { content: meow() });
        run.sent++;
        const max = settings.store.maxMeows;
        if (max > 0 && run.sent >= max) stop(channelId, `Done meowing (${run.sent} meows)`);
        else schedule(channelId);
    }, delay);
}

function start(channelId: string) {
    running.set(channelId, { timer: null, sent: 0 });
    sendMessage(channelId, { content: meow() });
    running.get(channelId)!.sent = 1;
    schedule(channelId);
    changed();
    showToast({ text: "Auto-meowing here. Click the paw again to stop." });
}

function stop(channelId: string, msg = "Stopped meowing") {
    const run = running.get(channelId);
    if (run) clearTimeout(run.timer);
    running.delete(channelId);
    changed();
    showToast({ text: msg });
}

// ---------- button ----------
function PawIcon({ active }: { active: boolean; }) {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill={active ? "var(--status-positive)" : "currentColor"}>
            <ellipse cx="6" cy="9" rx="2.2" ry="2.8" />
            <ellipse cx="10" cy="5.5" rx="2.2" ry="2.8" />
            <ellipse cx="14" cy="5.5" rx="2.2" ry="2.8" />
            <ellipse cx="18" cy="9" rx="2.2" ry="2.8" />
            <path d="M12 11c-3 0-6.5 4.2-6.5 7 0 1.8 1.4 2.6 3 2.6 1.5 0 2.3-.8 3.5-.8s2 .8 3.5.8c1.6 0 3-.8 3-2.6 0-2.8-3.5-7-6.5-7z" />
        </svg>
    );
}

const AutoMeowButton = ({ channelId }: { channelId: string; }) => {
    const [, force] = useState(0);
    useEffect(() => {
        const f = () => force(n => n + 1);
        listeners.add(f);
        return () => void listeners.delete(f);
    }, []);
    const active = running.has(channelId);

    return (
        <ChatBarButton
            tooltip={active ? "Stop meowing" : "Auto meow (right-click: meow once)"}
            onClick={() => active ? stop(channelId) : start(channelId)}
            onContextMenu={e => {
                e.preventDefault();
                sendMessage(channelId, { content: meow() });
            }}
        >
            <PawIcon active={active} />
        </ChatBarButton>
    );
};

export default definePlugin({
    name: "AutoMeow",
    description: "Adds a paw button to the chat bar: click to keep meowing (meow, mrow, maiw, mrrrp, nya...) every so often, right-click to meow once",
    authors: [{ name: "Arham", id: 0n }],
    settings,

    chatBarButton: {
        icon: () => <PawIcon active={false} />,
        render: ({ channel, isMainChat }) => {
            if (!isMainChat || !ChannelStore.getChannel(channel.id)) return null;
            return <AutoMeowButton channelId={channel.id} />;
        },
    },

    stop() {
        for (const id of [...running.keys()]) stop(id);
    },
});
