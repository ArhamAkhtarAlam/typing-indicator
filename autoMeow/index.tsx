/*
 * AutoMeow: a paw button in the chat bar.
 *   click        -> send a meow (or a woof, yip, tweet... depending on the mode)
 *   hold         -> combo: one message with a burst (meow meow MEOW mrrrp!)
 *   right-click  -> switch mode (cat, dog, fox, bird, mixed)
 * Plus a translator (translator.tsx): with a message typed in the chat box, clicking the paw sends it in
 * animal language (so does starting it with !cat / !dog / !fox / !bird), and anyone else with AutoMeow
 * sees the real message under it.
 */

import { ChatBarButton } from "@api/ChatButtons";
import { definePluginSettings } from "@api/Settings";
import { sendMessage } from "@utils/discord";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, ComponentDispatch, DraftStore, DraftType, showToast, useRef, useStateFromStores } from "@webpack/common";

import { Animal as LangAnimal, ANIMALS as LANGS, encode, MAX_LEN, NAME, Translation } from "./translator";

const DEFAULTS = {
    cat: {
        normal: "meow, mew, miau, maio, mrow, meiw, maiw, meuw, miaw, mraow, mreow, meo, mjau, miao, mau, mrrow, mewo, maow, miu, mewww, meowr",
        rare: "mrrrp, mrrp, mrp?, prrrt, purrr, nya, nya~, nyaa, nyan, mrrrow, brrrp, prrrp?, :3, nyaaa~, mrrrrp :3, *purrs*, *headbutts you*",
    },
    dog: {
        normal: "ruff, woof, barks, arf, roof, ruf, awoo, grr, :>, wou, wouf, bork, bourf, wruff, o.o, gruff, owo, (ᵔᴥᵔ), boof, yap, aroo, bork bork",
        rare: "ruf ruf?, hwoof, hruff, wuff, arff, ruffles, wauf, wroof, woofies, ૮ ・ﻌ・ა, ▽・ᴥ・▽, >:3, U・ᴥ・U, *wags tail*, *zoomies*, *sniffs you*, *rolls over*, *steals your sock*",
    },
    fox: {
        normal: "yip, yap, yipyip, ack, eep, ehehe, wah, kyuu, kon, heh, awoo, yiip, ack ack, hehe",
        rare: "AAAAAA, *screams*, *pounces*, kon kon~, (^・ω・^ ), *chitters*, *wags tail*, *steals your shoe*, *dives into the snow*",
    },
    bird: {
        normal: "tweet, chirp, cheep, peep, tweet tweet, chirrup, coo, squawk, trill, kaw, cheep cheep, pip",
        rare: "*flaps wings*, *steals your fries*, (•ө•)♡, SKREEEE, *head tilt*, bwak?, *sits on your head*, *drops a feather*",
    },
};
type Animal = keyof typeof DEFAULTS;
const ANIMALS = Object.keys(DEFAULTS) as Animal[];
const MODES = [...ANIMALS, "mixed"] as const;
type Mode = typeof MODES[number];
const LABELS: Record<Mode, string> = { cat: "🐱 Cat", dog: "🐶 Dog", fox: "🦊 Fox", bird: "🐦 Bird", mixed: "🎲 Mixed" };

const words = (animal: string, kind: string, def: string) => ({
    type: OptionType.STRING as const,
    description: `${animal} – ${kind}, separated by commas. Add your own!`,
    default: def,
});

const settings = definePluginSettings({
    mode: {
        type: OptionType.SELECT,
        description: "What to send (right-click the paw to switch quickly)",
        options: MODES.map(m => ({ label: LABELS[m], value: m, default: m === "cat" })),
    },
    rareChance: {
        type: OptionType.NUMBER,
        description: "Chance (in %) of a rare one (mrrrp, *wags tail*, ...) instead of a normal one",
        default: 15,
    },
    comboMax: {
        type: OptionType.NUMBER,
        description: "Hold the paw for a combo: the most sounds in one combo message (it picks 3 up to this)",
        default: 6,
    },
    stretch: {
        type: OptionType.BOOLEAN,
        description: "Randomly stretch, shout and decorate them (meeeow, WOOF, yip~)",
        default: true,
    },
    speakAll: {
        type: OptionType.BOOLEAN,
        description: "Translator: send every message in animal language, using the current mode (normally only the paw or !cat does that)",
        default: false,
    },
    showTranslations: {
        type: OptionType.BOOLEAN,
        description: "Translator: show the real message under animal-language messages",
        default: true,
    },
    // cat keeps its old setting names so lists you already edited stay
    meows: words("Cat", "normal", DEFAULTS.cat.normal),
    rare: words("Cat", "rare", DEFAULTS.cat.rare),
    dogNormal: words("Dog", "normal", DEFAULTS.dog.normal),
    dogRare: words("Dog", "rare", DEFAULTS.dog.rare),
    foxNormal: words("Fox", "normal", DEFAULTS.fox.normal),
    foxRare: words("Fox", "rare", DEFAULTS.fox.rare),
    birdNormal: words("Bird", "normal", DEFAULTS.bird.normal),
    birdRare: words("Bird", "rare", DEFAULTS.bird.rare),
});

const KEYS: Record<Animal, [keyof typeof settings.store, keyof typeof settings.store]> = {
    cat: ["meows", "rare"],
    dog: ["dogNormal", "dogRare"],
    fox: ["foxNormal", "foxRare"],
    bird: ["birdNormal", "birdRare"],
};

// ---------- generator ----------
const rand = (n: number) => Math.floor(Math.random() * n);
const pick = <T,>(a: T[]) => a[rand(a.length)];
const chance = (p: number) => Math.random() < p;

// your list from the settings (comma-separated), or the default if you emptied it
function list(txt: unknown, fallback: string) {
    const split = (s: string) => s.split(",").map(w => w.trim()).filter(Boolean);
    const mine = typeof txt === "string" ? split(txt) : [];
    return mine.length ? mine : split(fallback);
}

// stretch one letter: meow -> meeeow, ruff -> ruuuff
function stretch(w: string) {
    const spots = [...w].map((c, i) => "aeiouyr".includes(c) ? i : -1).filter(i => i >= 0);
    if (!spots.length) return w;
    const i = pick(spots);
    return w.slice(0, i) + w[i].repeat(2 + rand(4)) + w.slice(i + 1);
}

export function sound(mode: Mode = settings.store.mode ?? "cat") {
    const animal: Animal = mode === "mixed" ? pick(ANIMALS) : (DEFAULTS[mode] ? mode : "cat");
    const [nk, rk] = KEYS[animal];
    const normal = list(settings.store[nk], DEFAULTS[animal].normal);
    const rareList = list(settings.store[rk], DEFAULTS[animal].rare);
    const rare = chance(settings.store.rareChance / 100);

    let w = rare ? pick(rareList) : pick(normal);
    const fx = settings.store.stretch;
    if (fx && chance(0.35)) w = stretch(w);
    if (fx && !rare && chance(0.2)) w = `${w} ${pick(normal)}`;   // ruff woof
    if (fx && chance(0.12)) w = w.toUpperCase();                  // MEOW
    if (fx && chance(0.3)) w += pick(["~", "!", "?", " :3", "!!", "~~", " >w<"]);
    return w;
}

// one message with a burst: "meow meow MEOW mrrrp!"
export function combo(mode: Mode) {
    const animal: Animal = mode === "mixed" ? pick(ANIMALS) : mode;
    const max = Math.max(3, settings.store.comboMax || 6);
    const n = 3 + rand(max - 2);
    let out = Array.from({ length: n }, () => sound(animal)).join(" ");
    if (!/[!?~]$/.test(out)) out += pick(["!", "!!", "~", "!!!"]);
    return out;
}

const HOLD_MS = 400;

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

const nextMode = (m: Mode) => {
    const next = MODES[(MODES.indexOf(m) + 1) % MODES.length];
    settings.store.mode = next;
    showToast({ text: `${LABELS[next]} mode` });
};
const langOf = (m: Mode): LangAnimal => m === "mixed" ? pick(LANGS) : m;
const draftOf = (channelId: string) => (DraftStore.getDraft(channelId, DraftType.ChannelMessage) ?? "").trim();

// paw click with something typed in the chat box: send that in animal language instead of a meow
function sendTranslated(channelId: string, m: Mode, text: string) {
    const animal = langOf(m);
    const out = encode(text, animal);
    if (out.length > MAX_LEN) {
        showToast({ text: `Too long for ${NAME[animal].toLowerCase()} language (about 300 letters max)` });
        return;
    }
    // goes straight to Discord: RandomUwU and the speak-everything setting don't touch it again
    sendMessage(channelId, { content: out });
    ComponentDispatch.dispatchToLastSubscribed("CLEAR_TEXT");
}

function MeowButton({ channelId }: { channelId: string; }) {
    const { mode } = settings.use(["mode"]);
    const m: Mode = MODES.includes(mode) ? mode : "cat";
    const typed = useStateFromStores([DraftStore], () => !!draftOf(channelId));
    const hold = useRef<{ timer: any; fired: boolean; }>({ timer: null, fired: false });
    const cancel = () => clearTimeout(hold.current.timer);

    return (
        <ChatBarButton
            tooltip={typed
                ? `Send your message in ${LABELS[m]} language`
                : `${LABELS[m]} (hold for a combo, right-click to switch)`}
            buttonProps={{
                onPointerDown: e => {
                    if (e.button !== 0) return;
                    hold.current.fired = false;
                    cancel();
                    hold.current.timer = setTimeout(() => {
                        hold.current.fired = true;
                        sendMessage(channelId, { content: combo(m) });
                    }, HOLD_MS);
                },
                onPointerUp: cancel,
                onPointerLeave: cancel,
            }}
            onClick={() => {
                cancel();
                if (hold.current.fired) { hold.current.fired = false; return; }   // the hold already sent a combo
                const text = draftOf(channelId);
                if (text) sendTranslated(channelId, m, text);
                else sendMessage(channelId, { content: sound(m) });
            }}
            onContextMenu={e => { e.preventDefault(); nextMode(m); }}
        >
            <PawIcon />
        </ChatBarButton>
    );
}

export default definePlugin({
    name: "AutoMeow",
    description: "Adds a paw button to the chat bar: click it to send a meow (or woof, yip, tweet...), hold it for a combo, right-click to switch animal. If you've typed a message, the paw sends it in animal language instead, and friends with AutoMeow see the real text",
    authors: [{ name: "Arham", id: 0n }],
    settings,

    onBeforeMessageSend(_channelId, msg) {
        const content = msg.content;
        if (!content.trim() || content.startsWith("/")) return;

        let animal: LangAnimal | null = null, text = content;
        const m = content.match(/^\s*!(cat|dog|fox|bird)\s+([\s\S]+)$/i);
        if (m) { animal = m[1].toLowerCase() as LangAnimal; text = m[2]; }
        else if (settings.store.speakAll && !/^\s*!(uwu|dodge)\b/i.test(content)) {
            animal = langOf(MODES.includes(settings.store.mode) ? settings.store.mode : "cat");
        }
        if (!animal) return;

        const out = encode(text, animal);
        if (out.length > MAX_LEN) {
            showToast({ text: `Too long for ${NAME[animal].toLowerCase()} language (about 300 letters max), sent it normally` });
            msg.content = text;
            return;
        }
        msg.content = out;
        (msg as any).meowTranslated = true;   // RandomUwU leaves it alone, so it can still be decoded
    },

    renderMessageAccessory: ({ message }) => (
        settings.store.showTranslations ? <Translation message={message} /> : null
    ),

    chatBarButton: {
        icon: PawIcon,
        render: ({ channel, isMainChat }) => {
            if (!isMainChat || !ChannelStore.getChannel(channel.id)) return null;
            return <MeowButton channelId={channel.id} />;
        },
    },
});
