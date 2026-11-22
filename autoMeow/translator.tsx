/*
 * The animal-language translator inside AutoMeow.
 *
 * What you see is just normal AutoMeow noises ("meow mrrrp nya~"). The real message is hidden inside it
 * in invisible characters (zero-width characters Discord keeps but never draws, the same ones the
 * InvisibleChat plugin uses), so it looks like any other meow.
 *
 * How the hidden part works:
 *   1. [1 byte: which animal] + your text as bytes + [2 checksum bytes]
 *   2. all of that is read as one big number
 *   3. the number is written in base 6, one invisible character per digit (6 different ones)
 *   4. those characters go right after the first plain word
 * Each invisible character holds ~2.6 bits, so a message can be ~600 letters.
 *
 * The same trick does whispers ("sounds good ;; he's lying": everyone sees "sounds good", AutoMeow users
 * also see the secret), and a 3-character signature at the end of your messages lets other AutoMeow
 * users show a paw badge next to your name.
 *
 * Don't change INVISIBLE or its order: people with a different list can't read your messages.
 */

import { Message } from "@vencord/discord-types";
import { Parser } from "@webpack/common";

export type Animal = "cat" | "dog" | "fox" | "bird";
export const ANIMALS: Animal[] = ["cat", "dog", "fox", "bird"];
export const EMOJI: Record<Animal, string> = { cat: "🐱", dog: "🐶", fox: "🦊", bird: "🐦" };
export const NAME: Record<Animal, string> = { cat: "Cat", dog: "Dog", fox: "Fox", bird: "Bird" };
export const MAX_LEN = 2000;

const INVISIBLE = ["\u200c", "\u200d", "\u2061", "\u2062", "\u2063", "\u2064"];
const DIGIT = new Map(INVISIBLE.map((c, i) => [c, i]));
const B = BigInt(INVISIBLE.length);

// a small checksum (2 bytes), so stray invisible characters aren't mistaken for a message
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

// one "~" is fine, but two of them make strikethrough: always send "\~"
export const escapeTildes = (s: string) => s.replace(/\\?~/g, "\\~");

// payload kinds (first hidden byte): 1-4 = animal translation, 5 = whisper
const WHISPER = 5;
export type Hidden = { kind: Animal | "whisper"; text: string; };

function hide(kind: number, text: string) {
    const body = [...new TextEncoder().encode(text)];
    const bytes = [kind, ...body, ...check(body)];
    let n = 0n;
    for (const b of bytes) n = n * 256n + BigInt(b);
    let hidden = "";
    while (n > 0n) { hidden = INVISIBLE[Number(n % B)] + hidden; n /= B; }
    return hidden;
}

// put the invisible part after a plain word, so links, mentions and emojis aren't broken
function tuck(visible: string, hidden: string) {
    const words = visible.split(" ");
    const i = words.findIndex(w => /^[\p{L}\p{N}'’!?.,\\~]+$/u.test(w));
    if (i < 0) return visible + " " + hidden;
    words[i] += hidden;
    return words.join(" ");
}

// hide `text` inside `cover` (some visible meows)
export const encode = (text: string, animal: Animal, cover: string) =>
    tuck(escapeTildes(cover.trim()), hide(1 + ANIMALS.indexOf(animal), text));

// "sounds good" + secret "he's lying"
export const whisper = (visible: string, secret: string) => tuck(visible, hide(WHISPER, secret));

// ---------- signature: tells other AutoMeow users you have it too ----------
export const SIGN = "\u2064\u2063\u2064";
// found anywhere (RandomUwU may add a face after it), but not as part of a longer hidden message
export const signed = (content: string) => /(^|\s)\u2064\u2063\u2064(?![\u200c\u200d\u2061-\u2064])/.test(content);
export const sign = (content: string) =>
    !content.trim() || signed(content) || content.length + 4 > MAX_LEN ? content : content + " " + SIGN;
export const hasInvisible = (content: string) => /[\u200c\u200d\u2061-\u2064]/.test(content);

function read(run: string): Hidden | null {
    let n = 0n;
    for (const c of run) n = n * B + BigInt(DIGIT.get(c)!);
    const bytes: number[] = [];
    while (n > 0n) { bytes.unshift(Number(n % 256n)); n /= 256n; }
    if (bytes.length < 3) return null;
    const kind = bytes[0] === WHISPER ? "whisper" : ANIMALS[bytes[0] - 1];
    if (!kind) return null;
    const body = bytes.slice(1, -2), sum = bytes.slice(-2), want = check(body);
    if (sum[0] !== want[0] || sum[1] !== want[1]) return null;
    const text = utf8(body);
    return text === null ? null : { kind, text };
}

export function decode(content: string): Hidden | null {
    if (!hasInvisible(content)) return null;
    const runs = content.match(/[\u200c\u200d\u2061-\u2064]{8,}/g) ?? [];
    for (const run of runs) {
        const r = read(run);
        if (r) return r;
    }
    return null;
}

// ---------- shown under a message ----------
export function Translation({ message }: { message: Message; }) {
    const content = message.content ?? "";
    const t = decode(content);
    if (!t) return null;
    const label = t.kind === "whisper" ? "🤫 Whisper:" : `${EMOJI[t.kind]} ${NAME[t.kind]} → English:`;
    return (
        <div style={{ color: "var(--text-muted)", fontSize: 14, marginTop: 2 }}>
            <i>{label}</i>{" "}
            <span style={{ color: "var(--text-normal)" }}>{Parser.parse(t.text)}</span>
        </div>
    );
}
