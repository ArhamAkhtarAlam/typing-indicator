# Plan: tests + pull-request workflow

**Status:** in review (PR)
**Branch:** `setup/tests-and-pr-workflow`

## Goal

Make every change go through the same steps before it reaches friends:

1. Get clarity first (questions answered before building).
2. A plan doc like this one in `docs/plans/`.
3. Test cases in `tests/`, written with the feature.
4. Tests pass before committing.
5. Work on a branch, then a pull request on GitHub.
6. The PR is reviewed (and GitHub's checks are green) before merging into `main`.

## Decisions

| Question | Decision |
|---|---|
| How PRs get opened | GitHub CLI (`gh`), installed with Homebrew; the owner logs in once with `gh auth login` |
| Where tests live | `tests/` in the repo, run with `npm test` |
| Tests on GitHub | A GitHub Action runs them on every PR (green check before merging) |
| Plan docs | One Markdown file per feature in `docs/plans/` |
| Rules for Claude | Written in `CLAUDE.md` at the repo root |

## How the tests work

The plugins import Vencord and Discord internals (`@api/...`, `@webpack/common`, ...) that only exist
inside Discord. `tests/run.mjs` bundles each test with esbuild and swaps those imports for small fakes
in `tests/stubs/vencord.ts` (fake settings with the plugin's real defaults, fake DataStore, fake chat box,
fake "only you can see this" messages). Then Node's built-in test runner runs them.

What is covered where:

| What | How |
|---|---|
| AutoMeow translator (hide/read messages, `\~`, signature) | unit tests, `tests/autoMeow.test.ts` |
| AutoMeow plugin (`!cat` etc., paw badge) | unit tests through the plugin's hooks |
| RandomUwU (uwuify, traps, stacking, `!dodge`, `!escape`, saving) | unit tests, `tests/randomUwu.test.ts` |
| All four plugins compile and type-check inside real Vencord | GitHub Action job `vencord-build` |
| `install-prebuilt.ps1` on real Windows PowerShell 5.1 | GitHub Action job `windows-installer` (fake Discord folders, then checks the app.asar it wrote) |

## Tasks

- [x] Install `gh`
- [ ] Owner runs `gh auth login` (needed to open the PR)
- [x] `docs/plans/` + this plan
- [x] `tests/` + `npm test`
- [x] GitHub Action `tests.yml` (unit tests, Vencord build, Windows installer)
- [x] `CLAUDE.md` with the rules
- [x] Tests pass locally: `npm test` 44/44; Windows installer test 31/31 (in PowerShell 7 on Linux; GitHub runs it on 5.1)
- [ ] PR opened, checks green, reviewed, merged

## Found while writing the tests (not fixed here)

- With AutoMeow's *speakAll* on, `!escape` and the codes typed during an escape get turned into meows,
  so RandomUwU never sees them and the escape can't work. Needs its own small fix (and test).

## Test cases for this setup

- `npm test` passes on a clean checkout (after `npm ci`).
- A deliberately broken plugin makes `npm test` fail (checked: putting back the old `!u-uwu` bug fails 1 test; reverted).
- The GitHub Action shows all three jobs on the PR.
