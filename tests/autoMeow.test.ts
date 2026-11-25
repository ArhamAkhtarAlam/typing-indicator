import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import AutoMeow, { combo, sound } from "../autoMeow/index";
import { ANIMALS, decode, encode, escapeTildes, hasInvisible, MAX_LEN, sign, signed } from "../autoMeow/translator";
import { fake } from "./stubs/vencord";

const plugin = AutoMeow as any;
const INVISIBLE = /[‌‍⁡-⁤]/g;
const visible = (s: string) => s.replace(INVISIBLE, "");
const send = (content: string, channelId = "c1") => {
    const msg: any = { content };
    plugin.onBeforeMessageSend(channelId, msg);
    return msg;
};

beforeEach(() => {
    fake.reset();
    Object.assign(plugin.settings.store, { speakAll: false, signMessages: true, showBadges: true, mode: "cat" });
});

describe("translator: hiding and reading messages", () => {
    const texts = ["hi bestie, see you at 8", "a", "émoji 🐱🔥 and ünïcödé", "two\nlines", "**bold** ~~strike~~ <@123>", "x".repeat(500)];

    for (const animal of ANIMALS) {
        test(`round trip in ${animal} language`, () => {
            for (const text of texts) {
                const out = encode(text, animal, "meow mrrp nya");
                assert.deepEqual(decode(out), { kind: animal, text });
            }
        });
    }

    test("the visible part is just the cover, with ~ escaped", () => {
        const out = encode("secret", "cat", "meow~ mrow~~ nya");
        assert.equal(visible(out), "meow\\~ mrow\\~\\~ nya");
        assert.ok(hasInvisible(out));
    });

    test("the hidden part sits after the first plain word, not inside a mention or emoji", () => {
        const out = encode("secret", "dog", "<@123> :dog: woof bark");
        assert.ok(out.startsWith("<@123> :dog: woof"), out);
        assert.ok(!visible(out).includes("  "));
    });

    test("about 600 letters still fit in one Discord message", () => {
        const out = encode("a".repeat(600), "cat", "meow meow meow meow meow meow meow");
        assert.ok(out.length <= MAX_LEN, `length ${out.length}`);
    });

    test("normal text and stray invisible characters don't decode", () => {
        assert.equal(decode("just a normal message"), null);
        assert.equal(decode(sign("meow")), null);
        const chars = ["‌", "‍", "⁡", "⁢", "⁣", "⁤"];
        let falsePositives = 0;
        for (let i = 0; i < 3000; i++) {
            const run = Array.from({ length: 8 + (i % 40) }, () => chars[Math.floor(Math.random() * 6)]).join("");
            if (decode(`meow${run} mrow`)) falsePositives++;
        }
        assert.ok(falsePositives <= 1, `${falsePositives} random runs decoded`);
    });

    test("escapeTildes never doubles an existing escape", () => {
        assert.equal(escapeTildes("a~b~~c"), "a\\~b\\~\\~c");
        assert.equal(escapeTildes("a\\~b"), "a\\~b");
    });
});

describe("translator: signature for the paw badge", () => {
    test("sign adds it once, signed finds it", () => {
        const s = sign("meow");
        assert.ok(signed(s));
        assert.equal(sign(s), s);
        assert.equal(visible(s).trim(), "meow");
    });

    test("empty and almost-full messages aren't signed", () => {
        assert.equal(sign("  "), "  ");
        const full = "a".repeat(MAX_LEN - 2);
        assert.equal(sign(full), full);
    });

    test("a hidden message isn't mistaken for a signature", () => {
        let wrong = 0;
        for (let i = 0; i < 200; i++) if (signed(encode(`msg ${i}`, "fox", "yip yap"))) wrong++;
        assert.equal(wrong, 0);
    });
});

describe("AutoMeow plugin: sending", () => {
    test("!dog <text> is sent in dog language, signed, and marked for RandomUwU", () => {
        const msg = send("!dog see you at 8");
        assert.deepEqual(decode(msg.content), { kind: "dog", text: "see you at 8" });
        assert.ok(signed(msg.content));
        assert.equal(msg.meowTranslated, true);
    });

    test("normal messages are left exactly as typed (Cat Bot still sees 'cat')", () => {
        assert.equal(send("cat").content, "cat");
        assert.equal(send("hello there").content, "hello there");
    });

    test("slash commands and empty messages are left alone", () => {
        plugin.settings.store.speakAll = true;
        assert.equal(send("/shrug").content, "/shrug");
        assert.equal(send("   ").content, "   ");
    });

    test("speakAll translates everything except !uwu and !dodge", () => {
        plugin.settings.store.speakAll = true;
        assert.deepEqual(decode(send("hello").content), { kind: "cat", text: "hello" });
        assert.equal(send("!uwu <@222> x3").content, "!uwu <@222> x3");
        assert.equal(send("!dodge").content, "!dodge");
    });

    test("signing can be turned off", () => {
        plugin.settings.store.signMessages = false;
        const msg = send("!cat hi");
        assert.ok(!signed(msg.content));
        assert.equal(decode(msg.content)?.text, "hi");
    });

    test("a message too long for animal language is sent normally with a toast", () => {
        const long = "z".repeat(1500);
        const msg = send(`!bird ${long}`);
        assert.equal(msg.content, long);
        assert.equal(fake.toasts.length, 1);
    });

    test("sounds and combos are never empty, and combos end with ! ? or ~", () => {
        for (const mode of [...ANIMALS, "mixed"] as const) {
            for (let i = 0; i < 50; i++) {
                assert.ok(sound(mode).trim().length > 0);
                assert.match(combo(mode), /[!?~]$/);
            }
        }
    });
});

describe("AutoMeow plugin: paw badge", () => {
    const deco = (id: string, content: string) => plugin.renderMessageDecoration({ message: { author: { id }, content } });

    test("someone whose message is signed gets the 🐾, and keeps it on later normal messages", () => {
        assert.equal(deco("333", "hello"), null);
        assert.ok(deco("333", sign("meow")));
        assert.ok(deco("333", "a normal message later"));
    });

    test("you never get a badge on your own messages", () => {
        assert.equal(deco(fake.me, sign("meow")), null);
    });

    test("badges can be turned off", () => {
        plugin.settings.store.showBadges = false;
        assert.equal(deco("444", sign("meow")), null);
    });
});
