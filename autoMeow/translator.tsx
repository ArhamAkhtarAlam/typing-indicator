/*
 * The animal-language translator inside AutoMeow.
 *
 * How a message is turned into meows:
 *   1. the text becomes bytes, plus 2 checksum bytes (so normal meowing isn't mistaken for a message)
 *   2. all of that is read as one big number
 *   3. the number is written out in "digits" where every digit is a whole word, and each word says
 *      four things at once:
 *        - which sound it is  (32 per animal: meow, mrow, maio, nya, ...)
 *        - how stretched      (meow, meeow, meeeow, meeeeow)
 *        - case               (meow, MEOW, Meow)
 *        - what follows it    (nothing ! ? \~ ... !! ?! ,)
 *      = 3072 possibilities per word, about 11.6 bits, so one word carries ~1.5 letters.
 *   Which letter gets stretched is random, it doesn't matter for decoding.
 *   "~" is always sent as "\~" so Discord never turns anything into strikethrough.
 *
 * Don't change the word lists or the order: people with a different list can't read your messages.
 */

import { Message } from "@vencord/discord-types";
import { Parser } from "@webpack/common";

export type Animal = "cat" | "dog" | "fox" | "bird";
export const ANIMALS: Animal[] = ["cat", "dog", "fox", "bird"];
export const EMOJI: Record<Animal, string> = { cat: "🐱", dog: "🐶", fox: "🦊", bird: "🐦" };
export const NAME: Record<Animal, string> = { cat: "Cat", dog: "Dog", fox: "Fox", bird: "Bird" };
export const MAX_LEN = 2000;

// 32 sounds each, written without double letters (stretching adds those: mrp -> mrrrp, pur -> purrr)
const WORDS: Record<Animal, string[]> = {
    cat: ["meow", "mew", "mrp", "mrow", "nya", "prt", "pur", "miau", "mraow", "mreow", "maow", "meo", "nyan", "prp", "miu", "maio",
        "mrau", "meiw", "maiw", "meuw", "miaw", "mjau", "miao", "mau", "mewo", "mrowr", "mrew", "nyaw", "brp", "mewr", "nyo", "mia"],
    dog: ["wof", "ruf", "arf", "bork", "awo", "gr", "wuf", "bof", "yap", "wouf", "bark", "hwof", "aro", "wruf", "borf", "bourf",
        "waf", "wau", "rof", "grof", "hruf", "bow", "wow", "yarf", "wauf", "wurf", "bwof", "howl", "yawp", "grauf", "rawr", "wuof"],
    fox: ["yip", "ack", "ep", "kyu", "kon", "wah", "heh", "hehe", "ehe", "gek", "chir", "kek", "yipyip", "ackack", "wa", "yif",
        "kyon", "kekek", "yowl", "eh", "hah", "aha", "yiek", "yek", "wek", "kya", "heki", "yarp", "chit", "konkon", "yi", "ahe"],
    bird: ["twet", "chirp", "chep", "pep", "co", "squawk", "tril", "kaw", "pip", "caw", "chirup", "twe", "hot", "kre", "bwak", "tsip",
        "cro", "skre", "pew", "pi", "kakaw", "tui", "wit", "chip", "twep", "kwa", "krak", "bawk", "pyu", "chirik", "tiu", "piu"],
};
const STRETCH = 4;                     // letter run of 1..4
const CASES = 3;                       // lower, UPPER, Capital
const PUNCT = ["", "!", "?", "\\~", "...", "!!", "?!", ","];
const W = 32, BASE = BigInt(W * STRETCH * CASES * PUNCT.length);
const STRETCHY = "aeiouyrw";

const rand = (n: number) => Math.floor(Math.random() * n);
export const squash = (w: string) => w.replace(/(.)\1+/g, "$1");   // meeeow -> meow, mrrrp -> mrp

// a small checksum (2 bytes)
function check(bytes: number[]) {
    let h = 0x811c;
    for (const b of bytes) h = Math.imul(h ^ b, 0x01000193) >>> 0;
    return [h & 255, (h >>> 8) & 255];
}

function utf8(bytes: number[]) {
    try {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
        return /[\x00-\x08\x0b-\x1f\x7f]/.test(text) ? null : text;
    } catch { return null; }
}

export function encode(text: string, animal: Animal) {
    const list = WORDS[animal];
    const body = [...new TextEncoder().encode(text)];
    const bytes = [1, ...body, ...check(body)];     // the leading 1 keeps leading zero bytes
    let n = 0n;
    for (const b of bytes) n = n * 256n + BigInt(b);

    const out: string[] = [];
    while (n > 0n) {
        let d = Number(n % BASE);
        n /= BASE;
        let w = list[d % W]; d = Math.floor(d / W);
        const run = d % STRETCH + 1; d = Math.floor(d / STRETCH);
        const kase = d % CASES; const punct = Math.floor(d / CASES);
        if (run > 1) {
            const spots = [...w].map((c, i) => STRETCHY.includes(c) ? i : -1).filter(i => i >= 0);
            const i = spots[rand(spots.length)];
            w = w.slice(0, i) + w[i].repeat(run) + w.slice(i + 1);
        }
        if (kase === 1) w = w.toUpperCase();
        else if (kase === 2) w = w[0].toUpperCase() + w.slice(1);
        out.push(w + PUNCT[punct]);
    }
    return out.join(" ");
}

const INDEX = Object.fromEntries(ANIMALS.map(a => [a, new Map(WORDS[a].map((w, i) => [w, i]))])) as Record<Animal, Map<string, number>>;

function decodeWords(toks: string[], idx: Map<string, number>): number[] | null {
    let n = 0n;
    for (let t = toks.length - 1; t >= 0; t--) {
        const m = toks[t].match(/^([A-Za-z]+)(.*)$/);
        if (!m) return null;
        const punct = PUNCT.indexOf(m[2]);
        if (punct < 0) return null;
        const letters = m[1], lower = letters.toLowerCase();
        const kase = letters === lower ? 0
            : letters === letters.toUpperCase() ? 1
                : letters === lower[0].toUpperCase() + lower.slice(1) ? 2 : -1;
        if (kase < 0) return null;
        const run = Math.max(...(lower.match(/(.)\1*/g) ?? [""]).map(r => r.length));
        const w = idx.get(squash(lower));
        if (w === undefined || run > STRETCH) return null;
        n = n * BASE + BigInt(w + W * (run - 1 + STRETCH * (kase + CASES * punct)));
    }
    const bytes: number[] = [];
    while (n > 0n) { bytes.unshift(Number(n % 256n)); n /= 256n; }
    return bytes;
}

// ---------- old version (from the first MeowTranslator), only read, never sent ----------
const OLD: Record<Animal, string[]> = {
    cat: ["meow", "mew", "mrrp", "mrow", "nya", "prrt", "purr", "miau", "mraow", "mreow", "maow", "meo", "mrp", "nyan", "prrp", "miu"],
    dog: ["woof", "ruff", "arf", "bork", "awoo", "grr", "wuff", "boof", "yap", "ruf", "wouf", "bark", "hwoof", "aroo", "wruff", "borf"],
    fox: ["yip", "ack", "eep", "kyuu", "kon", "wah", "yiip", "heh", "hehe", "ehehe", "gekk", "chirr", "kek", "yipyip", "ackack", "wa"],
    bird: ["tweet", "chirp", "cheep", "peep", "coo", "squawk", "trill", "kaw", "pip", "caw", "chirrup", "twee", "hoot", "kree", "bwak", "tsip"],
};
const OLD_INDEX = Object.fromEntries(ANIMALS.map(a => [a, new Map(OLD[a].map((w, i) => [w, i]))])) as Record<Animal, Map<string, number>>;
const mixOld = (b: number, i: number) => b ^ ((i * 73 + 41) & 255);
const letterWords = (content: string) =>
    content.toLowerCase().split(/\s+/).map(t => t.replace(/[^a-z]/g, "")).filter(Boolean);

function decodeOld(content: string) {
    const toks = letterWords(content);
    if (toks.length < 6 || toks.length % 2) return null;
    for (const animal of ANIMALS) {
        const idx = OLD_INDEX[animal];
        if (!toks.every(t => idx.has(t))) continue;
        const bytes: number[] = [];
        for (let i = 0; i < toks.length; i += 2) bytes.push(mixOld(idx.get(toks[i])! * 16 + idx.get(toks[i + 1])!, i / 2));
        const sum = bytes.splice(-2), want = check(bytes);
        if (sum[0] !== want[0] || sum[1] !== want[1]) continue;
        const text = utf8(bytes);
        if (text !== null) return { animal, text };
    }
    return null;
}

export function decode(content: string): { animal: Animal; text: string; } | null {
    const toks = content.trim().split(/\s+/);
    if (toks.length >= 3 && toks.length <= 400) {
        for (const animal of ANIMALS) {
            const bytes = decodeWords(toks, INDEX[animal]);
            if (!bytes || bytes.length < 3 || bytes[0] !== 1) continue;
            const body = bytes.slice(1, -2), sum = bytes.slice(-2), want = check(body);
            if (sum[0] !== want[0] || sum[1] !== want[1]) continue;
            const text = utf8(body);
            if (text !== null) return { animal, text };
        }
    }
    return decodeOld(content);
}

// ---------- made-up translations for normal animal noises ----------
const EXTRA: Record<Animal, string> = {
    cat: "meow mew mrrp purr maio maiw meuw miaw meiw mjau miao mau mrrow meowr mraw brrrp nyaa prrrt mewo",
    dog: "woof ruff wou roof barks bourf gruff wauf wroof woofies ruffles hruff arff boof yap aroo awoo bork",
    fox: "yip kyu awoo yiiip kon",
    bird: "tweet chirp cheep peep coo squawk caaw hoot",
};
// words people also type normally, so they never get a fake translation on their own
const HUMAN = new Set(["heh", "hehe", "ehehe", "he", "eh", "ehe", "ack", "eep", "ep", "wah", "wa", "kek", "ke", "kekek",
    "hah", "aha", "ahe", "yi", "wow", "bow", "co", "hot", "pi", "wit", "chip", "pep", "tui", "cro", "pew", "howl", "kon", "konkon", "chit"]);
const VOCAB = Object.fromEntries(ANIMALS.map(a => [a,
    new Set([...WORDS[a], ...OLD[a], ...EXTRA[a].split(" ")].map(squash).filter(w => !HUMAN.has(w)))
])) as Record<Animal, Set<string>>;

const FAKE: Record<Animal, string[]> = {
    cat: [
        "excuse me, where is my food", "pet me. no, not like that", "I have decided to sit on your keyboard",
        "the red dot has returned", "I knocked it off the table on purpose", "feed me or I scream at 4am",
        "this box is mine now", "I love you (don't tell anyone)", "what are you doing. stop. continue",
        "I saw a bird and you need to know", "you are my servant", "nap time. for 16 hours",
    ],
    dog: [
        "WHO IS AT THE DOOR", "is that food? is it for me?", "I love you I love you I love you",
        "walk? did someone say walk", "I found a stick, it's the best stick", "the mailman is my enemy",
        "ball. ball. BALL.", "I didn't eat the sock (I ate the sock)", "pls pet", "SQUIRREL",
        "you were gone for 5 minutes, I thought you died", "good boy? me? yes",
    ],
    fox: [
        "I stole your shoe and I'm not giving it back", "AAAAAAAAAA", "I'm going to dig a hole in your garden",
        "chaos time", "I buried something important, don't ask", "snow! must dive in head first",
        "I'm cute so you can't be mad", "this is a trap. probably", "zoomies at 3am", "what does the fox say? this.",
    ],
    bird: [
        "I'll be screaming at sunrise, you're welcome", "give me that fry", "I'm a dinosaur, respect me",
        "I saw myself in the mirror and he's handsome", "there's a cat outside and I'm reporting it",
        "seed. now.", "I'm sitting on your head now", "that's my shiny thing", "bread??", "I have gossip",
    ],
};

export function fake(content: string, id: string): { animal: Animal; text: string; } | null {
    const toks = letterWords(content).map(squash);
    if (!toks.length || toks.length > 20) return null;
    let best: Animal | null = null, bestN = 0;
    for (const a of ANIMALS) {
        const v = VOCAB[a];
        if (!toks.every(t => v.has(t) || HUMAN.has(t))) continue;
        const n = toks.filter(t => v.has(t)).length;
        if (n > bestN) { best = a; bestN = n; }
    }
    if (!best) return null;
    let h = 0;
    for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;   // same message, same translation
    return { animal: best, text: FAKE[best][h % FAKE[best].length] };
}

// ---------- shown under a message ----------
export function Translation({ message, real: showReal, fake: showFake }: { message: Message; real: boolean; fake: boolean; }) {
    const content = message.content ?? "";
    if (!content) return null;
    const real = showReal ? decode(content) : null;
    const made = !real && showFake ? fake(content, message.id) : null;
    const t = real ?? made;
    if (!t) return null;
    return (
        <div style={{ color: "var(--text-muted)", fontSize: 14, marginTop: 2 }}>
            {EMOJI[t.animal]} <i>{real ? `${NAME[t.animal]} → English:` : "probably means:"}</i>{" "}
            <span style={{ color: "var(--text-normal)" }}>{real ? Parser.parse(t.text) : t.text}</span>
        </div>
    );
}
