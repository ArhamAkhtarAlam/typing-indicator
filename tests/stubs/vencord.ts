/*
 * Fakes for everything the plugins import from Vencord / Discord (@api/*, @utils/*, @webpack/common, ...).
 * tests/run.mjs points all of those imports here. Tests look at and reset the fake state through `fake`.
 */

const G = globalThis as any;

// ---------- state the tests can look at ----------
export const fake = G.__fake ??= {
    me: "111",
    db: {} as Record<string, any>,          // DataStore
    sent: [] as { channelId: string; content: string; }[],   // sendMessage from @utils/discord
    bot: [] as { channelId: string; content: string; }[],    // sendBotMessage (only-you-can-see messages)
    toasts: [] as string[],
    drafts: {} as Record<string, string>,   // chat box text per channel
    cleared: 0,                             // times the chat box was cleared
    guilds: {} as Record<string, string | undefined>,  // channel id -> guild id (missing = DM)
    reset() {
        this.db = {}; this.sent = []; this.bot = []; this.toasts = []; this.drafts = {}; this.cleared = 0; this.guilds = {};
    },
};

// ---------- @utils/types ----------
export const OptionType = { STRING: 0, NUMBER: 1, BIGINT: 2, BOOLEAN: 3, SELECT: 4, SLIDER: 5, COMPONENT: 6, CUSTOM: 7 };
export default function definePlugin<T>(p: T) { return p; }
export type PluginNative<T> = any;

// ---------- @api/Settings: a store filled with each setting's real default ----------
export function definePluginSettings(defs: Record<string, any>) {
    const store: Record<string, any> = {};
    for (const [k, d] of Object.entries(defs)) {
        store[k] = d.type === OptionType.SELECT ? d.options?.find((o: any) => o.default)?.value : d.default;
    }
    const s = { store, def: defs, use: () => store, withPrivateSettings: () => s };
    return s;
}

// ---------- @api/DataStore ----------
export const get = async (k: string) => fake.db[k] === undefined ? undefined : JSON.parse(JSON.stringify(fake.db[k]));
export const set = async (k: string, v: any) => { fake.db[k] = JSON.parse(JSON.stringify(v)); };

// ---------- @api/Commands, @utils/discord ----------
export function sendBotMessage(channelId: string, m: { content: string; }) { fake.bot.push({ channelId, content: m.content }); return m; }
export function sendMessage(channelId: string, m: { content: string; }) { fake.sent.push({ channelId, content: m.content }); return Promise.resolve(); }
export const openUserProfile = () => { };

// ---------- @webpack/common ----------
export const UserStore = { getCurrentUser: () => ({ id: fake.me }), getUser: (id: string) => ({ id }) };
export const ChannelStore = { getChannel: (id: string) => ({ id, guild_id: fake.guilds[id] }) };
export const DraftType = { ChannelMessage: 0 };
export const DraftStore = { getDraft: (channelId: string) => fake.drafts[channelId] ?? "" };
export const ComponentDispatch = {
    dispatchToLastSubscribed: (e: string) => { if (e === "CLEAR_TEXT") fake.cleared++; },
};
export const showToast = (t: string) => { fake.toasts.push(t); };
export const Parser = { parse: (t: string) => t };
export const useRef = (v: any) => ({ current: v });
export const useStateFromStores = (_s: any, f: () => any) => f();
export const React = { createElement: () => null, Fragment: "fragment" };
export const ChatBarButton = () => null;

// JSX in the plugins compiles to these (same names Vencord's build uses)
G.VencordCreateElement ??= (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } });
G.VencordFragment ??= "fragment";
