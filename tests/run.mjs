// npm test: bundle every tests/*.test.ts(x) with the Vencord/Discord imports swapped for tests/stubs/vencord.ts,
// then run them with Node's built-in test runner. Extra args go to node --test (e.g. --test-name-pattern=escape).
import { spawnSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, ".out");
const stub = join(here, "stubs", "vencord.ts");

// every import that only exists inside Vencord/Discord goes to the stub
const vencordImports = {
    name: "vencord-stubs",
    setup(b) {
        b.onResolve({ filter: /^(@api|@utils|@webpack|@vencord|@components|@shared)(\/|$)|^electron$/ }, () => ({ path: stub }));
    },
};

const tests = readdirSync(here).filter(f => /\.test\.tsx?$/.test(f));
if (!tests.length) { console.error("no tests found"); process.exit(1); }

rmSync(out, { recursive: true, force: true });
await build({
    entryPoints: tests.map(f => join(here, f)),
    outdir: out,
    outExtension: { ".js": ".mjs" },
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    jsxFactory: "VencordCreateElement",
    jsxFragment: "VencordFragment",
    plugins: [vencordImports],
    logLevel: "warning",
});

const files = readdirSync(out).filter(f => f.endsWith(".mjs")).map(f => join(out, f));
const r = spawnSync(process.execPath, ["--test", ...process.argv.slice(2), ...files], { stdio: "inherit" });
process.exit(r.status ?? 1);
