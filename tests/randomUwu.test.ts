import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, mock, test } from "node:test";

import RandomUwU, { addTraps, stackCount, uwuify } from "../randomUwu/index";
import { fake } from "./stubs/vencord";

const plugin = RandomUwU as any;
const FRIEND = "222";

// every test gets its own channel, because traps live in the plugin between tests
let n = 0, ch = "";
// a fake clock that jumps an hour per test, so dodge/escape cooldowns from earlier tests are over
let clock = Date.parse("2026-01-01T00:00:00Z");

const send = (content: string, channelId = ch) => {
    const msg: any = { content };
    const r = plugin.onBeforeMessageSend(channelId, msg);
    return r?.cancel ? null : msg.content as string;   // null = not sent
};
const fromFriend = (content: string, opts: { channelId?: string; mentions?: string[]; author?: string; } = {}) =>
    plugin.flux.MESSAGE_CREATE({
        optimistic: false,
        message: { author: { id: opts.author ?? FRIEND }, channel_id: opts.channelId ?? ch, content, mentions: opts.mentions ?? [] },
    });
// how many of the next messages get uwuified (sends plain "hello there" until one comes out normal)
const trapsLeft = (channelId = ch) => {
    let k = 0;
    while (send("hello there", channelId) !== "hello there") if (++k > 200) break;
    return k;
};
const lastBot = () => fake.bot.at(-1)?.content ?? "";
const shownCode = () => lastBot().match(/\*\*(.+)\*\*/)![1];   // with the invisible anti-paste characters
const typedCode = () => shownCode().replace(/​/g, "");

beforeEach(() => {
    fake.reset();
    ch = `chan${++n}`;
    clock += 3600_000;
    mock.method(Date, "now", () => clock);
    Object.assign(plugin.settings.store, {
        chance: 0, friendTrigger: true, triggerUsers: "", wobbleAt: 20, stackLimit: 100,
        dodgeChance: 30, escapeRounds: 3, escapeSeconds: 10, escapeCooldown: 30,
    });
});
afterEach(() => mock.restoreAll());

describe("uwuify", () => {
    test("changes words but keeps links, mentions, emojis and code", () => {
        const keep = ["<@123>", "https://example.com/really/hello", ":smile:", "`really hello`"];
        for (const level of ["light", "medium", "extreme"] as const) {
            const out = uwuify(`hello ${keep.join(" ")} I really love this`, level);
            for (const k of keep) assert.ok(out.includes(k), `${level}: lost ${k} in ${out}`);
            assert.ok(/hewwo|h-hewwo/i.test(out), out);
        }
    });

    test("random uwu chance 0 never changes a message, 100 always does", () => {
        assert.equal(send("hello there"), "hello there");
        plugin.settings.store.chance = 100;
        assert.notEqual(send("hello there"), "hello there");
    });
});

describe("!uwu trap", () => {
    test("in a DM, a friend's !uwu uwuifies your next message once", () => {
        fromFriend("!uwu");
        assert.equal(trapsLeft(), 1);
    });

    test("in a server they have to tag you", () => {
        fake.guilds[ch] = "guild1";
        fromFriend("!uwu");
        assert.equal(trapsLeft(), 0);
        fromFriend(`!uwu <@${fake.me}>`, { mentions: [fake.me] });
        assert.equal(trapsLeft(), 1);
    });

    test("your own !uwu doesn't trap you, and nothing happens when the setting is off", () => {
        fromFriend("!uwu", { author: fake.me });
        assert.equal(trapsLeft(), 0);
        plugin.settings.store.friendTrigger = false;
        fromFriend("!uwu");
        assert.equal(trapsLeft(), 0);
    });

    test("'Only these people' limits who can trap you", () => {
        plugin.settings.store.triggerUsers = "999, 888";
        fromFriend("!uwu");
        assert.equal(trapsLeft(), 0);
        fromFriend("!uwu", { author: "888" });
        assert.equal(trapsLeft(), 1);
    });

    test("a stuttered !u-uwu from a trapped friend still counts", () => {
        fromFriend("!u-uwu <@111> x3 owo");
        fromFriend("!u-u-uwu");
        assert.equal(trapsLeft(), 4);
    });

    test("your own !uwu is never uwuified and doesn't use up a trap", () => {
        fromFriend("!uwu x2");
        assert.equal(send(`!uwu <@${FRIEND}> x10`), `!uwu <@${FRIEND}> x10`);
        assert.equal(trapsLeft(), 2);
    });

    test("AutoMeow's translated messages are left alone", () => {
        fromFriend("!uwu");
        const msg: any = { content: "meow‌‍ mrow", meowTranslated: true };
        plugin.onBeforeMessageSend(ch, msg);
        assert.equal(msg.content, "meow‌‍ mrow");
        assert.equal(send("!cat hi"), "!cat hi");
        assert.equal(trapsLeft(), 1);
    });
});

describe("stacking", () => {
    test("reading the number", () => {
        assert.equal(stackCount("!uwu <@1> x10"), 10);
        assert.equal(stackCount("!uwu ×5"), 5);
        assert.equal(stackCount("!uwu"), 1);
        assert.equal(stackCount("!uwu x0"), 1);
        assert.equal(stackCount("!uwu x9999"), 100);
    });

    test("up to wobbleAt always sticks, past it they can fizzle", () => {
        let roll = 0;                               // (mock once: mocking twice breaks restoring it)
        mock.method(Math, "random", () => roll);
        assert.equal(addTraps(ch, 30), 20);         // roll 0: every one past 20 fizzles
        roll = 0.999;
        assert.equal(addTraps(ch + "b", 30), 30);   // roll 0.999: none fizzle
    });

    test("never more than stackLimit in a channel", () => {
        mock.method(Math, "random", () => 0.999);
        assert.equal(addTraps(ch, 150), 100);
        assert.equal(addTraps(ch, 5), 0);
    });

    test("!uwu x5 adds 5", () => {
        fromFriend("!uwu x5");
        assert.equal(trapsLeft(), 5);
    });
});

describe("!dodge", () => {
    test("a lucky dodge clears every trap; a second one while tired always fails and adds one", () => {
        fromFriend("!uwu x3");
        mock.method(Math, "random", () => 0);       // 0 < 30% -> lucky
        assert.match(send("!dodge")!, /🛡️|⚔️/);
        mock.restoreAll(); mock.method(Date, "now", () => clock);
        assert.equal(trapsLeft(), 0);

        mock.method(Math, "random", () => 0);       // would be lucky, but legs are tired
        const out = send("!dodge")!;
        assert.doesNotMatch(out, /🛡️/);
        mock.restoreAll(); mock.method(Date, "now", () => clock);
        assert.equal(trapsLeft(), 1);
    });
});

describe("!escape", () => {
    test("typing all 3 codes in time removes every trap and sends 'uwus removed'", () => {
        fromFriend("!uwu x7");
        assert.equal(send("!escape"), null);
        for (let round = 1; round <= 3; round++) {
            assert.match(lastBot(), new RegExp(`Code ${round}/3`));
            assert.ok(shownCode().includes("​"), "code shown with anti-paste characters");
            const out = send(typedCode());
            if (round < 3) assert.equal(out, null);
            else assert.equal(out, "uwus removed");
        }
        assert.equal(trapsLeft(), 0);
    });

    test("the chat box is cleared after !escape and after each code", async () => {
        await new Promise(r => setTimeout(r, 5));   // let clears from earlier tests finish first
        fake.cleared = 0;
        send("!escape");
        send(typedCode());
        await new Promise(r => setTimeout(r, 5));
        assert.equal(fake.cleared, 2);
    });

    test("a wrong code: +3 traps, nothing sent, the right code shown only to you", () => {
        fromFriend("!uwu");
        send("!escape");
        assert.equal(send("nope"), null);
        assert.match(lastBot(), /Wrong.*\+3 traps/);
        assert.equal(fake.sent.length, 0);
        assert.equal(trapsLeft(), 4);
    });

    test("pasting the code (with its invisible characters) fails", () => {
        send("!escape");
        assert.equal(send(shownCode()), null);
        assert.match(lastBot(), /No copy-pasting/);
        assert.equal(trapsLeft(), 3);
    });

    test("too slow fails", () => {
        send("!escape");
        const code = typedCode();
        clock += 11_000;
        assert.equal(send(code), null);
        assert.match(lastBot(), /Too slow/);
        assert.equal(trapsLeft(), 3);
    });

    test("after a try you have to wait (escapeCooldown minutes)", () => {
        send("!escape");
        send("wrong");
        assert.equal(send("!escape"), null);
        assert.match(lastBot(), /Too tired to escape\. Try again in 30 min/);
        clock += 31 * 60_000;
        fake.bot = [];
        send("!escape");
        assert.match(fake.bot[0].content, /Escape attempt/);
    });
});

describe("saving across Discord restarts", () => {
    test("traps are saved, and loaded again on start", async () => {
        fromFriend("!uwu x4");
        await new Promise(r => setTimeout(r, 600));          // saving waits 500 ms
        assert.equal(fake.db.RandomUwU_state.traps[ch], 4);

        const other = ch + "-restored";
        fake.db.RandomUwU_state = { traps: { [other]: 2 }, tiredUntil: 0, escapeUntil: 0 };
        await plugin.start();
        assert.equal(trapsLeft(other), 2);
    });

    test("the escape cooldown is saved too", async () => {
        send("!escape");
        send("wrong");
        await new Promise(r => setTimeout(r, 600));
        assert.ok(fake.db.RandomUwU_state.escapeUntil > clock);
    });
});
