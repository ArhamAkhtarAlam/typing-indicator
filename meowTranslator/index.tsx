/*
 * MeowTranslator: talk in cat (or dog, fox, bird).
 *   - Turn on the speech-bubble button (or start a message with !cat / !dog / !fox / !bird) and your
 *     message is sent as animal noises: "mrrp meow nya prrt mew...".
 *   - Anyone else with MeowTranslator sees the real message translated under it. Everyone else just
 *     sees a cat yelling.
 *   - Normal meows/woofs from friends (not secret messages) get a made-up "translation" instead.
 */

import { ChatBarButton } from "@api/ChatButtons";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { Message } from "@vencord/discord-types";
import { ChannelStore, Parser, showToast } from "@webpack/common";

// 16 sounds per animal: every byte of your message becomes two of them.
// Don't change these, or people with the old list can't read your messages any more.
export const ALPHABETS = {
    cat: ["meow", "mew", "mrrp", "mrow", "nya", "prrt", "purr", "miau", "mraow", "mreow", "maow", "meo", "mrp", "nyan", "prrp", "miu"],
    dog: ["woof", "ruff", "arf", "bork", "awoo", "grr", "wuff", "boof", "yap", "ruf", "wouf", "bark", "hwoof", "aroo", "wruff", "borf"],
    fox: ["yip", "ack", "eep", "kyuu", "kon", "wah", "yiip", "heh", "hehe", "ehehe", "gekk", "chirr", "kek", "yipyip", "ackack", "wa"],
    bird: ["tweet", "chirp", "cheep", "peep", "coo", "squawk", "trill", "kaw", "pip", "caw", "chirrup", "twee", "hoot", "kree", "bwak", "tsip"],
};
export type Animal = keyof typeof ALPHABETS;
const ANIMALS = Object.keys(ALPHABETS) as Animal[];
const EMOJI: Record<Animal, string> = { cat: "🐱", dog: "🐶", fox: "🦊", bird: "🐦" };
const NAME: Record<Animal, string> = { cat: "Cat", dog: "Dog", fox: "Fox", bird: "Bird" };
const MAX_LEN = 2000;

const settings = definePluginSettings({
    animal: {
        type: OptionType.SELECT,
        description: "Which language the speech-bubble button speaks (right-click the button to switch)",
        options: ANIMALS.map(a => ({ label: `${EMOJI[a]} ${NAME[a]}`, value: a, default: a === "cat" })),
    },
    speakAll: {
        type: OptionType.BOOLEAN,
        description: "Send every message in animal language (same as clicking the speech-bubble button)",
        default: false,
    },
    showTranslations: {
        type: OptionType.BOOLEAN,
        description: "Show the real message under animal-language messages",
        default: true,
    },
    fakeTranslations: {
        type: OptionType.BOOLEAN,
        description: "Show a made-up translation under normal meows, woofs, yips and tweets",
        default: true,
    },
});

// ---------- the code ----------
const rand = (n: number) => Math.floor(Math.random() * n);
const pick = <T,>(a: T[]) => a[rand(a.length)];

// a small checksum (2 bytes), so a normal "meow meow mrrp" isn't mistaken for a secret message
function check(bytes: number[]) {
    let h = 0x811c;
    for (const b of bytes) h = Math.imul(h ^ b, 0x01000193) >>> 0;
    return [h & 255, (h >>> 8) & 255];
}
// scramble the bytes, otherwise every other word is the same ("purr mraow purr mreow purr...")
const mix = (b: number, i: number) => b ^ ((i * 73 + 41) & 255);

export function encode(text: string, animal: Animal) {
    const A = ALPHABETS[animal];
    const bytes = [...new TextEncoder().encode(text)];
    bytes.push(...check(bytes));
    const words: string[] = [];
    bytes.forEach((raw, i) => { const b = mix(raw, i); words.push(A[b >> 4], A[b & 15]); });
    // sound a bit more alive; the decoder ignores case and punctuation
    return words.map(w => {
        if (Math.random() < 0.07) w = w.toUpperCase();
        if (Math.random() < 0.12) w += pick(["~", "!", "?", "!!", "...", "~~"]);
        return w;
    }).join(" ");
}

const words = (content: string) =>
    content.toLowerCase().split(/\s+/).map(t => t.replace(/[^a-z]/g, "")).filter(Boolean);

const INDEX = Object.fromEntries(ANIMALS.map(a => [a, new Map(ALPHABETS[a].map((w, i) => [w, i]))])) as Record<Animal, Map<string, number>>;

export function decode(content: string): { animal: Animal; text: string; } | null {
    const toks = words(content);
    if (toks.length < 6 || toks.length % 2) return null;
    for (const animal of ANIMALS) {
        const idx = INDEX[animal];
        if (!toks.every(t => idx.has(t))) continue;
        const bytes: number[] = [];
        for (let i = 0; i < toks.length; i += 2) bytes.push(mix(idx.get(toks[i])! * 16 + idx.get(toks[i + 1])!, i / 2));
        const sum = bytes.splice(-2);
        const want = check(bytes);
        if (sum[0] !== want[0] || sum[1] !== want[1]) continue;
        try {
            const text = new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
            if (!/[\x00-\x08\x0b-\x1f\x7f]/.test(text)) return { animal, text };
        } catch { /* not valid text */ }
    }
    return null;
}

// ---------- made-up translations for normal animal noises ----------
const squash = (w: string) => w.replace(/(.)\1+/g, "$1");   // meeeow -> meow, mrrrp -> mrp

const EXTRA = {
    cat: "mewo maiw meuw miaw meiw maio mjau miao mau mrrow meowr mraw mrrrow brrrp purrr nyaa prrrt",
    dog: "wou roof barks bourf gruff wauf wroof woofies ruffles hruff arff boof yap aroo",
    fox: "yap kyu awoo yiiip kon",
    bird: "tweeet chirrrp squawkk caaw coo",
};
// words people also type normally, so they never get a fake translation on their own
const HUMAN = new Set(["heh", "hehe", "ehehe", "he", "eh", "ack", "eep", "ep", "wah", "wa", "kek", "ke"]);

const VOCAB = Object.fromEntries(ANIMALS.map(a => [a,
    new Set([...ALPHABETS[a], ...EXTRA[a].split(" ")].map(squash).filter(w => !HUMAN.has(w)))
])) as Record<Animal, Set<string>>;

const FAKE: Record<Animal, string[]> = {
    cat: [
        "excuse me, where is my food",
        "pet me. no, not like that",
        "I have decided to sit on your keyboard",
        "the red dot has returned",
        "I knocked it off the table on purpose",
        "feed me or I scream at 4am",
        "this box is mine now",
        "I love you (don't tell anyone)",
        "what are you doing. stop. continue",
        "I saw a bird and you need to know",
        "you are my servant",
        "nap time. for 16 hours",
    ],
    dog: [
        "WHO IS AT THE DOOR",
        "is that food? is it for me?",
        "I love you I love you I love you",
        "walk? did someone say walk",
        "I found a stick, it's the best stick",
        "the mailman is my enemy",
        "ball. ball. BALL.",
        "I didn't eat the sock (I ate the sock)",
        "pls pet",
        "SQUIRREL",
        "you were gone for 5 minutes, I thought you died",
        "good boy? me? yes",
    ],
    fox: [
        "I stole your shoe and I'm not giving it back",
        "AAAAAAAAAA",
        "I'm going to dig a hole in your garden",
        "chaos time",
        "I buried something important, don't ask",
        "snow! must dive in head first",
        "I'm cute so you can't be mad",
        "this is a trap. probably",
        "zoomies at 3am",
        "what does the fox say? this.",
    ],
    bird: [
        "I'll be screaming at sunrise, you're welcome",
        "give me that fry",
        "I'm a dinosaur, respect me",
        "I saw myself in the mirror and he's handsome",
        "there's a cat outside and I'm reporting it",
        "seed. now.",
        "I'm sitting on your head now",
        "that's my shiny thing",
        "bread??",
        "I have gossip",
    ],
};

export function fake(content: string, id: string): { animal: Animal; text: string; } | null {
    const toks = words(content).map(squash);
    if (!toks.length || toks.length > 20) return null;
    let best: Animal | null = null, bestN = 0;
    for (const a of ANIMALS) {
        const v = VOCAB[a];
        // every word has to be an animal noise (HUMAN words are allowed alongside real ones)
        if (!toks.every(t => v.has(t) || HUMAN.has(t))) continue;
        const n = toks.filter(t => v.has(t)).length;
        if (n > bestN) { best = a; bestN = n; }
    }
    if (!best) return null;
    let h = 0;
    for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;   // same message, same translation
    return { animal: best, text: FAKE[best][h % FAKE[best].length] };
}

// ---------- under-the-message translation ----------
function Translation({ message }: { message: Message; }) {
    const { showTranslations, fakeTranslations } = settings.use(["showTranslations", "fakeTranslations"]);
    const content = message.content ?? "";
    if (!content) return null;

    const real = showTranslations ? decode(content) : null;
    const made = !real && fakeTranslations ? fake(content, message.id) : null;
    const t = real ?? made;
    if (!t) return null;

    return (
        <div style={{ color: "var(--text-muted)", fontSize: 14, marginTop: 2 }}>
            {EMOJI[t.animal]} <i>{real ? `${NAME[t.animal]} → English:` : "probably means:"}</i>{" "}
            <span style={{ color: "var(--text-normal)" }}>{real ? Parser.parse(t.text) : t.text}</span>
        </div>
    );
}

// ---------- the button ----------
function BubbleIcon({ on }: { on?: boolean; }) {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style={on ? { color: "var(--brand-500, #5865f2)" } : undefined}>
            <path d="M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-7l-5 4v-4H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" opacity={on ? 1 : 0.85} />
            <circle cx="8" cy="9" r="1.3" fill="var(--background-primary, #000)" />
            <circle cx="16" cy="9" r="1.3" fill="var(--background-primary, #000)" />
            <path d="M9.5 12c.8.8 1.6.8 2.5 0 .9.8 1.7.8 2.5 0" stroke="var(--background-primary, #000)" strokeWidth="1.2" fill="none" strokeLinecap="round" />
        </svg>
    );
}

function SpeakButton() {
    const { speakAll, animal } = settings.use(["speakAll", "animal"]);
    const a: Animal = ANIMALS.includes(animal) ? animal : "cat";
    return (
        <ChatBarButton
            tooltip={`${EMOJI[a]} ${NAME[a]} language: ${speakAll ? "ON" : "off"} (right-click to switch animal)`}
            onClick={() => {
                settings.store.speakAll = !speakAll;
                showToast({ text: `${EMOJI[a]} ${NAME[a]} language ${!speakAll ? "on" : "off"}` });
            }}
            onContextMenu={e => {
                e.preventDefault();
                const next = ANIMALS[(ANIMALS.indexOf(a) + 1) % ANIMALS.length];
                settings.store.animal = next;
                showToast({ text: `${EMOJI[next]} ${NAME[next]} language` });
            }}
        >
            <BubbleIcon on={speakAll} />
        </ChatBarButton>
    );
}

export default definePlugin({
    name: "MeowTranslator",
    description: "Send messages in cat, dog, fox or bird language (speech-bubble button, or start with !cat / !dog / !fox / !bird). Others with this plugin see the real message underneath, and normal meows get a made-up translation",
    authors: [{ name: "Arham", id: 0n }],
    settings,

    onBeforeMessageSend(_channelId, msg) {
        const content = msg.content;
        if (!content.trim() || content.startsWith("/")) return;

        let animal: Animal | null = null, text = content;
        const m = content.match(/^\s*!(cat|dog|fox|bird)\s+([\s\S]+)$/i);
        if (m) { animal = m[1].toLowerCase() as Animal; text = m[2]; }
        else if (settings.store.speakAll && !/^\s*!(uwu|dodge)\b/i.test(content)) {
            animal = ANIMALS.includes(settings.store.animal) ? settings.store.animal : "cat";
        }
        if (!animal) return;

        const out = encode(text, animal);
        if (out.length > MAX_LEN) {
            showToast({ text: `Too long for ${NAME[animal].toLowerCase()} language (about 160 letters max), sent it normally` });
            msg.content = text;
            return;
        }
        msg.content = out;
        (msg as any).meowTranslated = true;   // RandomUwU leaves it alone, so it can still be decoded
    },

    renderMessageAccessory: ({ message }) => <Translation message={message} />,

    chatBarButton: {
        icon: () => <BubbleIcon />,
        render: ({ channel, isMainChat }) => {
            if (!isMainChat || !ChannelStore.getChannel(channel.id)) return null;
            return <SpeakButton />;
        },
    },
});
