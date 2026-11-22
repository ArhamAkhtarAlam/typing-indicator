/*
 * NoChillZone: closes Discord's "WOAH THERE. WAY TOO SPICY - You're sending messages too quickly!"
 * popup as soon as it shows up. Discord still makes you wait (that's on their side), and the
 * messages you sent go through once it lets you again. You just don't get the popup.
 */

import definePlugin from "@utils/types";

const TEXTS = ["sending messages too quickly", "way too spicy", "enter the chill zone"];

function isChillPopup(el: Element) {
    const t = (el.textContent ?? "").toLowerCase();
    return TEXTS.some(s => t.includes(s));
}

const handled = new WeakSet<Element>();

function close(dialog: Element) {
    if (handled.has(dialog)) return;
    handled.add(dialog);
    // click its own button ("Enter the chill zone"), which closes it the normal way
    const btn = [...dialog.querySelectorAll("button")]
        .find(b => (b.textContent ?? "").toLowerCase().includes("chill"))
        ?? dialog.querySelector('button[aria-label="Close"], [class*="close"] button, button');
    if (btn instanceof HTMLElement) btn.click();
    else document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }));
}

const DIALOG = '[role="dialog"], [role="alertdialog"]';

function scan(node: Node) {
    if (!(node instanceof Element)) return;
    // the popup itself, a popup inside what was added, or content added into an open popup
    const dialogs = new Set<Element>(node.querySelectorAll(DIALOG));
    const parent = node.closest(DIALOG);
    if (parent) dialogs.add(parent);
    for (const d of dialogs) if (isChillPopup(d)) close(d);
}

let observer: MutationObserver | null = null;

export default definePlugin({
    name: "NoChillZone",
    description: "Closes the \"WOAH THERE. WAY TOO SPICY / Enter the chill zone\" popup you get when sending messages fast",
    authors: [{ name: "Arham", id: 0n }],

    start() {
        observer = new MutationObserver(muts => {
            for (const m of muts) m.addedNodes.forEach(scan);
        });
        observer.observe(document.body, { childList: true, subtree: true });
    },

    stop() {
        observer?.disconnect();
        observer = null;
    },
});
