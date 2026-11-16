/*
 * TypingVerbs, a Vencord user plugin
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Swaps "X is typing..." for "X is meowing..." (or whatever each person picked).
 * Verbs are shared through a tiny server (e.g. on a Raspberry Pi), so everyone
 * running this plugin sees each other's custom verb.
 *
 * Patches are adapted from Vencord's built-in TypingTweaks plugin, so turn
 * TypingTweaks OFF while using this one (they patch the same spot).
 */

import { isPluginEnabled } from "@api/PluginManager";
import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { debounce } from "@shared/debounce";
import { openUserProfile } from "@utils/discord";
import { isNonNullish } from "@utils/guards";
import { Logger } from "@utils/Logger";
import { useForceUpdater } from "@utils/react";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { Channel, RenderModalProps, User } from "@vencord/discord-types";
import { AuthenticationStore, GuildMemberStore, Menu, Modal, openModal, React, RelationshipStore, showToast, TextInput, TypingStore, UserStore, useStateFromStores } from "@webpack/common";

const Native = VencordNative.pluginHelpers.TypingVerbs as PluginNative<typeof import("./native")>;
const logger = new Logger("TypingVerbs");

const VERB_RE = /^[\p{L}\p{M}\p{N}' \-!?~.]{1,32}$/u;
const DEFAULT_SERVER = "https://arham-pi.taila1cfdc.ts.net/typing-verbs";
const CACHE_TTL = 5 * 60_000;
const ERROR_TTL = 30_000;

function cleanVerb(raw: string) {
    // accept "meowing", "is meowing", "meowing..." – store just "meowing"
    return raw.trim().replace(/^(is|are)\s+/i, "").replace(/\.+$/, "").trim();
}

const settings = definePluginSettings({
    verb: {
        type: OptionType.STRING,
        description: "Your verb, as in \"<you> is ____...\" (e.g. meowing). Leave empty for normal typing.",
        default: "",
        placeholder: "meowing",
        isValid: (v: string) => !v || VERB_RE.test(cleanVerb(v)) || "1–32 letters/numbers/spaces, no weird symbols",
        onChange: () => pushVerbDebounced()
    },
    serverUrl: {
        type: OptionType.STRING,
        description: "Address of the TypingVerbs server. Everyone who should see each other's verbs needs the same one.",
        default: DEFAULT_SERVER,
        placeholder: DEFAULT_SERVER,
        onChange: () => { verbCache.clear(); pushVerbDebounced(); }
    },
    fallbackVerb: {
        type: OptionType.STRING,
        description: "What to show for people who haven't picked a verb",
        default: "typing"
    },
    roleColors: {
        type: OptionType.BOOLEAN,
        description: "Colour names by their role colour",
        default: true
    },
    token: {
        type: OptionType.STRING,
        description: "Secret that proves this account's verb belongs to you. Don't share it.",
        default: "",
        hidden: true
    },
    localVerbs: {
        // userId -> verb. Set by right-clicking someone. Only you see these, they beat the server's verb.
        type: OptionType.CUSTOM,
        default: {} as Record<string, string>
    }
});

/* ---------------- verbs only you see (right-click → Set typing verb) ---------------- */

function setLocalVerb(userId: string, verb: string | null) {
    const next = { ...settings.store.localVerbs };
    if (verb) next[userId] = verb;
    else delete next[userId];
    settings.store.localVerbs = next; // reassign so the typing indicator re-renders
}

function LocalVerbModal({ user, modalProps }: { user: User; modalProps: RenderModalProps; }) {
    const existing = settings.store.localVerbs[user.id] ?? "";
    const [value, setValue] = React.useState(existing);
    const verb = cleanVerb(value);
    const valid = !verb || VERB_RE.test(verb);

    const save = () => {
        if (!valid) return;
        setLocalVerb(user.id, verb || null);
        modalProps.onClose();
    };

    return (
        <Modal
            {...modalProps}
            size="sm"
            title={`Typing verb for ${(user as any).globalName || user.username}`}
            subtitle="Only you see this. It works even if they don't have the plugin, and beats the verb they picked."
            notice={valid ? undefined : { message: "1–32 letters, numbers or spaces", type: "critical" }}
            actions={[
                ...(existing ? [{ text: "Remove", variant: "secondary", onClick: () => { setLocalVerb(user.id, null); modalProps.onClose(); } }] : []),
                { text: "Save", variant: "primary", onClick: save, disabled: !valid }
            ]}
        >
            <form onSubmit={e => { e.preventDefault(); save(); }}>
                <TextInput
                    autoFocus
                    value={value}
                    placeholder="meowing"
                    onChange={(v: string) => setValue(v)}
                />
            </form>
        </Modal>
    );
}

const UserContext: NavContextMenuPatchCallback = (children, { user }: { user?: User; }) => {
    if (!user || user.id === AuthenticationStore.getId()) return;
    const current = settings.store.localVerbs[user.id];

    children.push(
        <Menu.MenuItem
            id="vc-typing-verbs-local"
            label={current ? `Typing verb: ${current} (only you see it)` : "Set typing verb (only you see it)"}
            action={() => openModal(props => <LocalVerbModal user={user} modalProps={props} />)}
        />
    );
};

/* ---------------- verb cache (batched lookups) ---------------- */

const verbCache = new Map<string, { verb: string | null; expires: number; }>();
const queued = new Set<string>();
const inflight = new Set<string>();
const listeners = new Set<() => void>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function requestVerbs(ids: string[]) {
    const now = Date.now();
    for (const id of ids) {
        const hit = verbCache.get(id);
        if ((hit && hit.expires > now) || inflight.has(id)) continue;
        queued.add(id);
    }
    if (queued.size && !flushTimer) flushTimer = setTimeout(flush, 50);
}

async function flush() {
    flushTimer = null;
    const ids = [...queued].slice(0, 50);
    ids.forEach(id => { queued.delete(id); inflight.add(id); });
    if (queued.size) flushTimer = setTimeout(flush, 50);

    const { serverUrl } = settings.store;
    try {
        const verbs = serverUrl ? await Native.getVerbs(serverUrl, ids) : {};
        const expires = Date.now() + CACHE_TTL;
        for (const id of ids) {
            const v = verbs[id];
            verbCache.set(id, { verb: typeof v === "string" && VERB_RE.test(v) ? v : null, expires });
        }
    } catch (e) {
        logger.warn("Couldn't fetch verbs:", e);
        const expires = Date.now() + ERROR_TTL;
        ids.forEach(id => verbCache.set(id, { verb: null, expires }));
    } finally {
        ids.forEach(id => inflight.delete(id));
        listeners.forEach(l => l());
    }
}

function useVerbs(ids: string[]) {
    const forceUpdate = useForceUpdater();
    React.useEffect(() => {
        listeners.add(forceUpdate);
        return () => void listeners.delete(forceUpdate);
    }, []);
    React.useEffect(() => requestVerbs(ids), [ids.join(",")]);
    return ids.map(id => verbCache.get(id)?.verb ?? null);
}

/* ---------------- publishing your own verb ---------------- */

let lastPushed: string | null = null;

async function pushVerb(quiet = false) {
    const { serverUrl, token } = settings.store;
    const verb = cleanVerb(settings.store.verb ?? "");
    const userId = AuthenticationStore.getId();
    if (!serverUrl || !userId) return;
    if (verb && !VERB_RE.test(verb)) return;

    const key = `${serverUrl}|${userId}|${verb}`;
    if (key === lastPushed) return;

    try {
        const res = await Native.setVerb(serverUrl, userId, verb, token);
        if (res.status === 200 || res.status === 201) {
            lastPushed = key;
            if (res.token) settings.store.token = res.token;
            verbCache.set(userId, { verb: verb || null, expires: Date.now() + CACHE_TTL });
            if (!quiet) showToast({ text: verb ? `You're now ${verb}!` : "Back to plain old typing", variant: "success" });
        } else if (res.status === 403) {
            showToast({ text: "TypingVerbs: the server says this account is claimed with a different token. Ask the server owner to reset it.", variant: "critical" });
        } else {
            if (!quiet) showToast({ text: `TypingVerbs: ${res.error ?? `server error ${res.status}`}`, variant: "critical" });
        }
    } catch (e) {
        logger.error("Couldn't save verb:", e);
        if (!quiet) showToast({ text: "TypingVerbs: couldn't reach the server", variant: "critical" });
    }
}

const pushVerbDebounced = debounce(() => pushVerb(false), 1500);

/* ---------------- rendering ---------------- */

function displayName(user: User, guildId?: string) {
    return (guildId && GuildMemberStore.getNick(guildId, user.id))
        || (!guildId && RelationshipStore.getNickname(user.id))
        || (user as any).globalName
        || user.username;
}

function Name({ user, guildId }: { user: User; guildId?: string; }) {
    return (
        <strong
            role="button"
            style={{
                cursor: "pointer",
                color: settings.store.roleColors && guildId ? GuildMemberStore.getMember(guildId, user.id)?.colorString : undefined
            }}
            onClick={() => openUserProfile(user.id)}
        >
            {displayName(user, guildId)}
        </strong>
    );
}

function joinNodes(nodes: React.ReactNode[]) {
    const out: React.ReactNode[] = [];
    nodes.forEach((n, i) => {
        if (i > 0) out.push(i === nodes.length - 1 ? " and " : ", ");
        out.push(n);
    });
    return out;
}

const TypingText = ErrorBoundary.wrap(function TypingText({ users, guildId, children }: { users: User[]; guildId?: string; children: React.ReactNode; }) {
    const verbs = useVerbs(users.map(u => u.id));
    const { localVerbs } = settings.use(["localVerbs"]);
    const fallback = cleanVerb(settings.store.fallbackVerb || "typing") || "typing";

    if (!users.length) return <>{children}</>;

    // your private override > their own verb from the server > fallback
    const resolved = verbs.map((v, i) => localVerbs[users[i].id] ?? v ?? fallback);
    // nobody has a custom verb and the fallback is plain "typing" → leave Discord's text alone
    if (resolved.every(v => v === "typing")) return <>{children}</>;

    if (users.length > 3) {
        const same = resolved.every(v => v === resolved[0]);
        return <>Several people are {same ? resolved[0] : "typing"}...</>;
    }

    // group people who share a verb: "A and B are meowing, C is barking..."
    const groups = new Map<string, User[]>();
    users.forEach((u, i) => {
        const list = groups.get(resolved[i]) ?? [];
        list.push(u);
        groups.set(resolved[i], list);
    });

    const parts = [...groups].map(([verb, members]) => (
        <React.Fragment key={verb}>
            {joinNodes(members.map(u => <Name key={u.id} user={u} guildId={guildId} />))}
            {members.length > 1 ? " are " : " is "}{verb}
        </React.Fragment>
    ));

    return <>{joinNodes(parts)}...</>;
}, { noop: true });

export default definePlugin({
    name: "TypingVerbs",
    description: "Replace \"is typing...\" with a custom verb like \"is meowing...\", synced with friends through your own server",
    authors: [{ name: "typing-indicator", id: 0n }],
    settings,

    contextMenus: {
        "user-context": UserContext
    },

    patches: [
        {
            find: "#{intl::SEVERAL_USERS_TYPING_STRONG}",
            group: true,
            replacement: [
                {
                    match: /(?<="aria-hidden":!0,children:)\i/,
                    replace: "$self.renderTypingUsers({ users: arguments[0]?.typingUserObjects, guildId: arguments[0]?.channel?.guild_id, children: $& })"
                },
                {
                    match: /(?<=function \i\(\i\)\{)(?=[^}]+?\{channel:\i,isThreadCreation:\i=!1,\.\.\.\i\})/,
                    replace: "let typingUserObjects = $self.useTypingUsers(arguments[0]?.channel);"
                },
                {
                    match: /typingUsers:(\i)\?\[\]:\i,/,
                    replace: "$&typingUserObjects: $1 || typeof typingUserObjects === 'undefined' ? [] : typingUserObjects,"
                }
            ]
        }
    ],

    start() {
        // re-announce on startup in case the server was wiped
        setTimeout(() => {
            pushVerb(true);
            if (isPluginEnabled("TypingTweaks"))
                showToast({ text: "TypingVerbs: turn off the TypingTweaks plugin, they clash!", variant: "critical" });
            else if (!settings.store.verb)
                showToast({ text: "TypingVerbs: pick your verb in Settings → Vencord → Plugins → TypingVerbs", variant: "success" });
        }, 5000);
    },

    useTypingUsers(channel: Channel | undefined): User[] {
        try {
            if (!channel) return [];
            const typingUsers = useStateFromStores([TypingStore], () => TypingStore.getTypingUsers(channel.id));
            const myId = useStateFromStores([AuthenticationStore], () => AuthenticationStore.getId());

            return Object.keys(typingUsers)
                .filter(id => id && id !== myId && !RelationshipStore.isBlockedOrIgnored(id))
                .map(id => UserStore.getUser(id))
                .filter(isNonNullish);
        } catch (e) {
            logger.error("Failed to get typing users:", e);
            return [];
        }
    },

    renderTypingUsers({ users, guildId, children }: { users?: User[]; guildId?: string; children: React.ReactNode; }) {
        if (!Array.isArray(users) || !users.length) return children;
        return <TypingText users={users} guildId={guildId}>{children}</TypingText>;
    }
});
