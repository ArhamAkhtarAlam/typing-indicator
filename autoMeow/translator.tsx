/*
 * The animal-language translator inside AutoMeow.
 *
 * How a message is turned into meows:
 *   1. the text becomes bytes, plus 2 checksum bytes (so normal meowing isn't mistaken for a message)
 *   2. all of that is read as one big number
 *   3. the number is written out in "digits" where every digit is a whole word, and each word says
 *      several things at once:
 *        - which sound it is      (28 per animal: mrow, maio, mjau, nyaw, ...)
 *        - how stretched           (mrow, mroow, mrooow, mroooow)
 *        - case                    (mrow, MROW, Mrow)
 *        - lookalike letters       an "o" can be Latin o, Cyrillic о or Greek ο, an "a" Latin a or
 *                                  Cyrillic а, and so on. They look the same, but each choice is data.
 *   4. then it's made to look natural: filler sounds that mean nothing (meow, mrrp, nya, purr) are
 *      sprinkled in, and random punctuation (! ? ... \~) is added. The decoder skips both.
 *   Which letter gets stretched is random too.
 *   "~" is always sent as "\~" so Discord never turns anything into strikethrough.
 *
 * Don't change the word lists, lookalikes or their order: people with a different list can't read your
 * messages.
 */

import { Message } from "@vencord/discord-types";
import { Parser } from "@webpack/common";

export type Animal = "cat" | "dog" | "fox" | "bird";
export const ANIMALS: Animal[] = ["cat", "dog", "fox", "bird"];
export const EMOJI: Record<Animal, string> = { cat: "🐱", dog: "🐶", fox: "🦊", bird: "🐦" };
export const NAME: Record<Animal, string> = { cat: "Cat", dog: "Dog", fox: "Fox", bird: "Bird" };
export const MAX_LEN = 2000;

// sounds that carry data, written without double letters (stretching adds those: mrp -> mrrrp)
const WORDS: Record<Animal, string[]> = {
    cat: ["mew", "mrow", "prt", "miau", "mraow", "mreow", "maow", "meo", "nyan", "prp", "miu", "maio", "mrau", "meiw",
        "maiw", "meuw", "miaw", "mjau", "miao", "mau", "mewo", "mrowr", "mrew", "nyaw", "brp", "mewr", "nyo", "mia"],
    dog: ["awo", "gr", "wuf", "bof", "yap", "wouf", "bark", "hwof", "aro", "wruf", "borf", "bourf", "waf", "wau",
        "rof", "grof", "hruf", "bow", "wow", "yarf", "wauf", "wurf", "bwof", "howl", "yawp", "grauf", "rawr", "wuof"],
    fox: ["kon", "wah", "heh", "hehe", "ehe", "gek", "chir", "kek", "yipyip", "ackack", "wa", "yif", "kyon", "kekek",
        "yowl", "eh", "hah", "aha", "yiek", "yek", "wek", "kya", "heki", "yarp", "chit", "konkon", "yi", "ahe"],
    bird: ["chep", "pep", "squawk", "tril", "kaw", "caw", "chirup", "twe", "hot", "kre", "bwak", "tsip", "cro", "skre",
        "pew", "pi", "kakaw", "tui", "wit", "chip", "twep", "kwa", "krak", "bawk", "pyu", "chirik", "tiu", "piu"],
};
// filler: sprinkled in to look natural, mean nothing
const FILLERS: Record<Animal, string[]> = {
    cat: ["meow", "mrp", "nya", "pur"],
    dog: ["wof", "bork", "ruf", "arf"],
    fox: ["yip", "ack", "kyu", "ep"],
    bird: ["twet", "chirp", "co", "pip"],
};

// lookalike letters: [lowercase versions, UPPERCASE versions], same count for both.
// Only Cyrillic/Greek ones that Discord's font draws like the Latin letter.
const LOOK: Record<string, [string[], string[]]> = {
    a: [["a", "а"], ["A", "А"]],
    c: [["c", "с", "ϲ"], ["C", "С", "Ϲ"]],
    e: [["e", "е"], ["E", "Е"]],
    h: [["h", "һ"], ["H", "Н"]],
    i: [["i", "і"], ["I", "І"]],
    j: [["j", "ј"], ["J", "Ј"]],
    o: [["o", "о", "ο"], ["O", "О", "Ο"]],
    p: [["p", "р"], ["P", "Р"]],
    s: [["s", "ѕ"], ["S", "Ѕ"]],
    x: [["x", "х"], ["X", "Х"]],
    y: [["y", "у"], ["Y", "Ү"]],
};
for (const l of "abcdefghijklmnopqrstuvwxyz") LOOK[l] ??= [[l], [l.toUpperCase()]];
const nv = (l: string) => LOOK[l][0].length;
// every character we write -> which letter, which version, upper or not
const REV = new Map<string, { l: string; v: number; up: boolean; }>();
for (const [l, [lo, hi]] of Object.entries(LOOK)) {
    lo.forEach((c, v) => REV.set(c, { l, v, up: false }));
    hi.forEach((c, v) => REV.set(c, { l, v, up: true }));
}

const STRETCH = 4;                     // letter run of 1..4
const CASES = 3;                       // lower, UPPER, Capital
const STRETCHY = "aeiouyrw";
const PUNCT = ["!", "?", "...", "\\~", "!!", ",", "?!", "!!!"];

const rand = (n: number) => Math.floor(Math.random() * n);
const pick = <T,>(a: T[]) => a[rand(a.length)];

const radix = (a: Animal, w: string) => [...w].reduce((r, l) => r * nv(l), WORDS[a].length * STRETCH * CASES);

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

// write one word: base sound, run length, case, version of each letter
function spell(w: string, run: number, kase: number, versions: number[]) {
    const spots = [...w].map((c, i) => STRETCHY.includes(c) ? i : -1).filter(i => i >= 0);
    const at = run > 1 ? pick(spots) : -1;
    let out = "";
    [...w].forEach((l, i) => {
        const n = i === at ? run : 1;
        for (let k = 0; k < n; k++) {
            const up = kase === 1 || (kase === 2 && i === 0 && k === 0);
            out += LOOK[l][up ? 1 : 0][versions[i]];
        }
    });
    return out;
}

const deco = () => Math.random() < 0.25 ? pick(PUNCT) : "";

function filler(a: Animal) {
    const w = pick(FILLERS[a]);
    return spell(w, 1 + rand(3), Math.random() < 0.15 ? 2 : 0, [...w].map(l => rand(nv(l)))) + deco();
}

export function encode(text: string, animal: Animal) {
    const list = WORDS[animal];
    const N = list.length;
    const body = [...new TextEncoder().encode(text)];
    const bytes = [1, ...body, ...check(body)];     // the leading 1 keeps leading zero bytes
    let n = 0n;
    for (const b of bytes) n = n * 256n + BigInt(b);

    const out: string[] = [];
    if (Math.random() < 0.4) out.push(filler(animal));
    while (n > 0n) {
        const w = list[Number(n % BigInt(N))];
        const R = BigInt(radix(animal, w));
        let d = Math.floor(Number(n % R) / N);
        n /= R;
        const run = d % STRETCH + 1; d = Math.floor(d / STRETCH);
        const kase = d % CASES; d = Math.floor(d / CASES);
        const versions = [...w].map(l => { const v = d % nv(l); d = Math.floor(d / nv(l)); return v; });
        out.push(spell(w, run, kase, versions) + deco());
        if (n > 0n && Math.random() < 0.18) out.push(filler(animal));
    }
    if (Math.random() < 0.3) out.push(filler(animal));
    return out.join(" ");
}

const INDEX = Object.fromEntries(ANIMALS.map(a => [a, new Map(WORDS[a].map((w, i) => [w, i]))])) as Record<Animal, Map<string, number>>;
const FILLER_SET = Object.fromEntries(ANIMALS.map(a => [a, new Set(FILLERS[a])])) as Record<Animal, Set<string>>;

type Read = { base: string; run: number; kase: number; versions: number[]; };

// undo spell(); null if it isn't one of our words
function read(token: string): Read | null {
    const t = token.replace(/^[!?.,~\\]+|[!?.,~\\]+$/g, "");
    if (!t) return null;
    const chars = [...t].map(c => REV.get(c));
    if (chars.some(c => !c)) return null;
    const cs = chars as { l: string; v: number; up: boolean; }[];
    const ups = cs.map(c => c.up);
    const kase = ups.every(u => !u) ? 0 : ups.every(u => u) ? 1 : ups[0] && ups.slice(1).every(u => !u) ? 2 : -1;
    if (kase < 0) return null;
    let base = "", run = 1;
    const versions: number[] = [];
    for (let i = 0; i < cs.length;) {
        let j = i;
        while (j < cs.length && cs[j].l === cs[i].l) {
            if (cs[j].v !== cs[i].v) return null;
            j++;
        }
        base += cs[i].l; versions.push(cs[i].v); run = Math.max(run, j - i);
        i = j;
    }
    return { base, run, kase, versions };
}

export function decode(content: string): { animal: Animal; text: string; } | null {
    const toks = content.trim().split(/\s+/);
    if (toks.length < 3 || toks.length > 600) return null;
    const reads = toks.map(read);
    if (reads.some(r => !r)) return null;
    for (const animal of ANIMALS) {
        const idx = INDEX[animal], N = WORDS[animal].length;
        const data = (reads as Read[]).filter(r => !FILLER_SET[animal].has(r.base));
        if (data.length < 3 || !data.every(r => idx.has(r.base) && r.run <= STRETCH)) continue;
        let n = 0n;
        for (let k = data.length - 1; k >= 0; k--) {
            const r = data[k];
            let d = 0;
            for (let i = r.base.length - 1; i >= 0; i--) d = d * nv(r.base[i]) + r.versions[i];
            d = (d * CASES + r.kase) * STRETCH + (r.run - 1);
            n = n * BigInt(radix(animal, r.base)) + BigInt(d * N + idx.get(r.base)!);
        }
        const bytes: number[] = [];
        while (n > 0n) { bytes.unshift(Number(n % 256n)); n /= 256n; }
        if (bytes.length < 3 || bytes[0] !== 1) continue;
        const body = bytes.slice(1, -2), sum = bytes.slice(-2), want = check(body);
        if (sum[0] !== want[0] || sum[1] !== want[1]) continue;
        const text = utf8(body);
        if (text !== null) return { animal, text };
    }
    return null;
}

// ---------- shown under a message ----------
export function Translation({ message }: { message: Message; }) {
    const content = message.content ?? "";
    const t = content ? decode(content) : null;
    if (!t) return null;
    return (
        <div style={{ color: "var(--text-muted)", fontSize: 14, marginTop: 2 }}>
            {EMOJI[t.animal]} <i>{NAME[t.animal]} → English:</i>{" "}
            <span style={{ color: "var(--text-normal)" }}>{Parser.parse(t.text)}</span>
        </div>
    );
}
