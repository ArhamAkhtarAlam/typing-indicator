/*
 * TypingVerbs, a Vencord user plugin
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Runs in Discord's main (Node) process, so requests to your Pi aren't blocked
// by Discord's Content-Security-Policy or by CORS.

import { IpcMainInvokeEvent } from "electron";

function endpoint(serverUrl: string, path: string) {
    const base = new URL(serverUrl);
    if (base.protocol !== "http:" && base.protocol !== "https:")
        throw new Error("Server URL must start with http:// or https://");
    return new URL(path, base.href.endsWith("/") ? base.href : base.href + "/");
}

export async function getVerbs(_: IpcMainInvokeEvent, serverUrl: string, ids: string[]) {
    const url = endpoint(serverUrl, "v1/verbs");
    url.searchParams.set("ids", ids.filter(id => /^\d{1,20}$/.test(id)).join(","));

    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`Server replied ${res.status}`);
    const body = await res.json();
    return (body?.verbs ?? {}) as Record<string, string>;
}

export async function setVerb(_: IpcMainInvokeEvent, serverUrl: string, userId: string, verb: string, token: string) {
    const res = await fetch(endpoint(serverUrl, "v1/verb"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, verb, token: token || undefined }),
        signal: AbortSignal.timeout(5000)
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, token: body?.token as string | undefined, error: body?.error as string | undefined };
}
