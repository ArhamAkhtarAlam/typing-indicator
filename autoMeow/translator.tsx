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
 *   4. those characters go between the first two words
 * Each invisible character holds ~2.6 bits, so a message can be ~600 letters.
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

const INVISIBLE = ["‌", "‍", "⁡", "⁢", "⁣", "⁤"];
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

// hide `text` inside `cover` (some visible meows)
export function encode(text: string, animal: Animal, cover: string) {
    const body = [...new TextEncoder().encode(text)];
    const bytes = [1 + ANIMALS.indexOf(animal), ...body, ...check(body)];
    let n = 0n;
    for (const b of bytes) n = n * 256n + BigInt(b);
    let hidden = "";
    while (n > 0n) { hidden = INVISIBLE[Number(n % B)] + hidden; n /= B; }

    const words = escapeTildes(cover.trim()).split(" ");
    return words.length < 2
        ? words[0] + hidden
        : words[0] + " " + hidden + words.slice(1).join(" ");
}

export function decode(content: string): { animal: Animal; text: string; } | null {
    let n = 0n, count = 0;
    for (const c of content) {
        const d = DIGIT.get(c);
        if (d === undefined) continue;
        n = n * B + BigInt(d);
        count++;
    }
    if (count < 8) return null;
    const bytes: number[] = [];
    while (n > 0n) { bytes.unshift(Number(n % 256n)); n /= 256n; }
    if (bytes.length < 3) return null;
    const animal = ANIMALS[bytes[0] - 1];
    if (!animal) return null;
    const body = bytes.slice(1, -2), sum = bytes.slice(-2), want = check(body);
    if (sum[0] !== want[0] || sum[1] !== want[1]) return null;
    const text = utf8(body);
    return text === null ? null : { animal, text };
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
