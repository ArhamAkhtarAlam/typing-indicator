# Working on this repo

Vencord plugins for Discord (TypingVerbs, ValorantDND, RandomUwU, AutoMeow), their installers
(`install.sh`, `install.ps1`, `install-prebuilt.ps1`) and the TypingVerbs sync server. Friends install
from `main`, so anything merged there reaches real people.

## Rules for every new feature, enhancement or task

1. **Get clarity first.** Ask the questions that change what gets built before writing code.
2. **Write a plan doc** in `docs/plans/<feature>.md`: goal, decisions, task checklist, test cases.
   Keep its checklist up to date while working.
3. **Prepare test cases** for the feature in `tests/` (see below) together with the code.
4. **Commit only after testing.** `npm test` must pass; say what couldn't be tested (e.g. real Discord).
5. **Work on a branch and open a pull request.** Never push straight to `main`.
6. **Push the PR to GitHub for review** (`gh pr create`). The owner reviews and merges; the PR's checks
   (unit tests, Vencord build, Windows installer) must be green first.

"Push it" from the owner means: push the branch and open/update the PR, not push to `main`.

## Tests

- `npm ci` once, then `npm test`: bundles `tests/*.test.ts` with esbuild, swapping every Vencord/Discord
  import (`@api/*`, `@utils/*`, `@webpack/common`, ...) for the fakes in `tests/stubs/vencord.ts`, then
  runs them with `node --test`. Test through a plugin's public hooks (`onBeforeMessageSend`, `flux`,
  `start`, `renderMessageDecoration`, ...) and its exports.
- Pin randomness and time with `mock.method(Math, "random", ...)` / `mock.method(Date, "now", ...)`.
  Mock a method only once per test (mocking it twice breaks `mock.restoreAll()`).
- `tests/windows/installer.ps1` runs `install-prebuilt.ps1` against fake Discord folders. GitHub runs it
  on Windows PowerShell 5.1 (`.github/workflows/tests.yml`).
- The `vencord-build` job type-checks and builds all plugins inside real Vencord. Locally:
  copy the plugin folders to `~/Vencord/src/userplugins`, then `npx tsc --noEmit -p .` and `pnpm build`.

## Things to keep in mind

- `install-prebuilt.ps1` must work in Windows PowerShell 5.1, possibly locked down (Device Guard /
  Smart App Control): no `.exe` files, avoid unusual .NET calls, wrap optional ones in `try`.
- AutoMeow's invisible-character list (`INVISIBLE` in `autoMeow/translator.tsx`) and its order must never
  change, or friends on different versions can't read each other's messages.
- The `prebuilt` release is rebuilt by `.github/workflows/prebuilt.yml` on every push to `main`.
