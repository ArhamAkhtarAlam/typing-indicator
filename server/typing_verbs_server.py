#!/usr/bin/env python3
"""
TypingVerbs server - stores each Discord user's custom typing verb.

No dependencies beyond Python 3.8+ (stdlib only), so it runs fine on a Pi.

  GET  /v1/verbs?ids=1,2,3        -> {"verbs": {"1": "meowing"}}
  POST /v1/verb  {userId, verb, token?}
        first time for a userId  -> 201 {"token": "..."}   (the plugin saves it)
        later, matching token    -> 200
        wrong / missing token    -> 403
        verb ""                  -> clears the verb (keeps your claim)
  GET  /health                    -> "ok"

Admin (run on the Pi):
  python3 typing_verbs_server.py --reset <discordUserId>   # free a claimed ID
  python3 typing_verbs_server.py --list
"""

import argparse
import hashlib
import hmac
import json
import re
import secrets
import sqlite3
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

VERB_RE = re.compile(r"^[\w' \-!?~.]{1,32}$", re.UNICODE)
ID_RE = re.compile(r"^\d{1,20}$")
MAX_IDS = 50
MAX_BODY = 2048

# simple per-IP rate limit for writes
WRITE_LIMIT = 20          # writes...
WRITE_WINDOW = 60         # ...per this many seconds


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class Store:
    def __init__(self, path: str):
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.lock = threading.Lock()
        self.db.execute(
            "CREATE TABLE IF NOT EXISTS users ("
            " user_id TEXT PRIMARY KEY,"
            " token_hash TEXT NOT NULL,"
            " verb TEXT,"
            " updated INTEGER NOT NULL)"
        )
        self.db.commit()

    def get_verbs(self, ids):
        if not ids:
            return {}
        q = "SELECT user_id, verb FROM users WHERE verb IS NOT NULL AND user_id IN (%s)" % ",".join("?" * len(ids))
        with self.lock:
            return dict(self.db.execute(q, ids).fetchall())

    def set_verb(self, user_id, verb, token):
        """Returns (status, new_token_or_None)."""
        with self.lock:
            row = self.db.execute("SELECT token_hash FROM users WHERE user_id = ?", (user_id,)).fetchone()
            now = int(time.time())
            if row is None:
                new_token = secrets.token_urlsafe(32)
                self.db.execute(
                    "INSERT INTO users (user_id, token_hash, verb, updated) VALUES (?, ?, ?, ?)",
                    (user_id, hash_token(new_token), verb or None, now),
                )
                self.db.commit()
                return 201, new_token
            if not token or not hmac.compare_digest(row[0], hash_token(token)):
                return 403, None
            self.db.execute("UPDATE users SET verb = ?, updated = ? WHERE user_id = ?", (verb or None, now, user_id))
            self.db.commit()
            return 200, None

    def reset(self, user_id):
        with self.lock:
            n = self.db.execute("DELETE FROM users WHERE user_id = ?", (user_id,)).rowcount
            self.db.commit()
            return n

    def list(self):
        with self.lock:
            return self.db.execute("SELECT user_id, verb, updated FROM users ORDER BY updated DESC").fetchall()


class Handler(BaseHTTPRequestHandler):
    store: Store = None
    write_log = {}
    write_lock = threading.Lock()
    server_version = "TypingVerbs/1.0"

    def log_message(self, fmt, *args):
        if self.server.verbose:
            super().log_message(fmt, *args)

    def client_ip(self):
        # honour X-Forwarded-For only if you're behind a proxy you trust (e.g. cloudflared on localhost)
        if self.server.trust_proxy:
            fwd = self.headers.get("X-Forwarded-For")
            if fwd:
                return fwd.split(",")[0].strip()
        return self.client_address[0]

    def send_json(self, status, obj):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def rate_limited(self):
        ip = self.client_ip()
        now = time.time()
        with self.write_lock:
            hits = [t for t in self.write_log.get(ip, []) if now - t < WRITE_WINDOW]
            limited = len(hits) >= WRITE_LIMIT
            if not limited:
                hits.append(now)
            self.write_log[ip] = hits
            if len(self.write_log) > 10000:  # don't grow forever
                self.write_log.clear()
        return limited

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/health":
            return self.send_json(200, {"ok": True})
        if url.path == "/v1/verbs":
            raw = parse_qs(url.query).get("ids", [""])[0]
            ids = [i for i in raw.split(",") if ID_RE.match(i)][:MAX_IDS]
            return self.send_json(200, {"verbs": self.store.get_verbs(ids)})
        self.send_json(404, {"error": "not found"})

    def do_POST(self):
        if urlparse(self.path).path != "/v1/verb":
            return self.send_json(404, {"error": "not found"})
        if self.rate_limited():
            return self.send_json(429, {"error": "slow down"})
        try:
            length = int(self.headers.get("Content-Length", 0))
            if length <= 0 or length > MAX_BODY:
                return self.send_json(400, {"error": "bad body"})
            data = json.loads(self.rfile.read(length))
        except (ValueError, json.JSONDecodeError):
            return self.send_json(400, {"error": "invalid json"})
        if not isinstance(data, dict):
            return self.send_json(400, {"error": "invalid json"})

        user_id = str(data.get("userId", ""))
        verb = str(data.get("verb") or "").strip()
        token = data.get("token")
        if not ID_RE.match(user_id):
            return self.send_json(400, {"error": "invalid userId"})
        if verb and not VERB_RE.match(verb):
            return self.send_json(400, {"error": "verb must be 1-32 letters, numbers or spaces"})
        if token is not None and not isinstance(token, str):
            return self.send_json(400, {"error": "invalid token"})

        status, new_token = self.store.set_verb(user_id, verb, token)
        if status == 403:
            return self.send_json(403, {"error": "this account is already claimed with a different token"})
        resp = {"ok": True, "verb": verb or None}
        if new_token:
            resp["token"] = new_token
        self.send_json(status, resp)


def main():
    p = argparse.ArgumentParser(description="TypingVerbs server")
    p.add_argument("--host", default="0.0.0.0")
    p.add_argument("--port", type=int, default=8787)
    p.add_argument("--db", default="typing_verbs.db")
    p.add_argument("--trust-proxy", action="store_true", help="use X-Forwarded-For for rate limiting")
    p.add_argument("--verbose", action="store_true")
    p.add_argument("--reset", metavar="USER_ID", help="remove a user's claim + verb and exit")
    p.add_argument("--list", action="store_true", help="print all stored verbs and exit")
    args = p.parse_args()

    store = Store(args.db)

    if args.reset:
        print("removed" if store.reset(args.reset) else "no such user")
        return
    if args.list:
        for uid, verb, updated in store.list():
            print(f"{uid}\t{verb or '-'}\t{time.strftime('%Y-%m-%d %H:%M', time.localtime(updated))}")
        return

    Handler.store = store
    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    srv.verbose = args.verbose
    srv.trust_proxy = args.trust_proxy
    print(f"TypingVerbs server listening on http://{args.host}:{args.port}", file=sys.stderr)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
