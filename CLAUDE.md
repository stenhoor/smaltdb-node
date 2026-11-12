# CLAUDE.md

This repository is `@smaltworks/smaltdb-node` ("smaltdb Node"), an optional plugin for
[smaltdb](https://github.com/stenhoor/smaltdb): files on disk in Node.js. It is a `Vfs` (smaltdb's file interface,
`smaltdb/engine`) over `node:fs`, with a lock per open file, so `Database.open(new NodeVfs(), 'orders.db')` keeps a
database on disk. It plugs in through `Database.open`, not the `SmaltPlugin` interface: the engine reaches files only
through a `Vfs` (smaltdb's [ADR 0012](https://github.com/stenhoor/smaltdb/blob/main/docs/adr/0012-plugins.md) on why
optional parts live in their own repositories).
Several Claude Code sessions work on the smalt repos in parallel and cannot see each other: this file is the shared
starting point, and its working rules match smaltdb's `CLAUDE.md`.

## Brand: read smalt-brand first

Before changing this repository's site, README, or how it describes the product, read smalt-brand's
[BRAND.md](https://github.com/stenhoor/smalt-brand/blob/main/BRAND.md) (the family table, and "Sites and READMEs", the
standard every product site and README follows) and
[DECISIONS.md](https://github.com/stenhoor/smalt-brand/blob/main/DECISIONS.md). A newer decision there wins over any
copy here: lines and roles change, and a copy taken before the change is out of date.

- Copy brand files and the site kit (`themes/vitepress/`) unchanged. To change them, change smalt-brand first, then
  copy them again.
- A change to this product's status or to what it does comes with a smalt-brand PR that updates smaltworks.dev (its
  status page and this product's page), linked with `Depends on:`.

## Commands

| Command | What it does | When |
|---|---|---|
| `npm ci && npm run deps` | Installs dependencies, then the pinned builds in `packed.json` (see below) | First, and again after every `npm ci` or `npm install` |
| `npm run check` | `npm run typecheck` then `npm test` (vitest): what CI runs | Before every commit |
| `npm run build` | `dist/`: the plugin (`index.js`) and its type declarations | Packaging checks |

## Before the first publish

smaltdb 0.9.0 and the other plugins are not on npm yet. `packed.json` pins each one to a commit;
`scripts/fetch-packed.mjs` builds those commits, packs them and installs the tarballs with `npm install --no-save`, so
they never reach `package.json` or the lockfile. To try an unmerged smaltdb change, run
`node scripts/fetch-packed.mjs --local smaltdb=../smaltdb`. The script is identical in every repository that uses it.
When 0.9.0 is published, the script and `packed.json` are deleted and the pins become `^0.9.0` dependencies.

Tests run smaltdb from the source in its packed build (`node_modules/smaltdb/src`), and may import its internals as
`smaltdb-src/...` (the engine server and worker protocol). The plugin's own code uses only the public `smaltdb/engine`
types; `npm run build` checks its declarations against smaltdb's published types.

## Rules for this plugin

- It runs only in Node: it imports `node:fs` and `node:path`, and nothing else at run time. The browser has OPFS
  (smaltdb's own `OpfsVfs`).
- It behaves as `OpfsVfs` does, so the engine can't tell them apart: one handle per file at a time (a second open is
  `SMALT_BUSY`; `shared: true` takes no lock, for parallel readers), `create: false` on a missing file is
  `SMALT_CANTOPEN`, and `flush` makes writes durable (fsync).
- Locks are files beside the database (`<path>.lock`, holding the process id). A lock whose process is gone is taken
  over; the tests kill a process that holds one (`test/helpers/commit-and-die.mjs`).
- SQL is its own package, smaltql (`@smaltworks/smaltql`, smaltdb ADR 0015), pinned in `packed.json` beside smaltdb, for
  the tests' databases (`test/setup-sql.ts` registers it).
- The plugin imports only types from `smaltdb/engine`; nothing from smaltdb is bundled or imported at run time. Its
  errors carry smaltdb's codes (`code: 'SMALT_BUSY'`) instead of importing `SmaltError`.
- No runtime dependencies. Adding one needs the owner's agreement: the plugin split exists to keep third-party code and licences out of packages that don't need them.
- A change to the plugin interface belongs in smaltdb first. Update the `smaltdb` pin here once it is merged.
- Don't reformat files with Prettier. No fixed sleeps in tests: wait with `until()` / `pause()` from
  `test/helpers/wait.ts`.

## Working rules for sessions

- One task per branch and PR. Do not add unrelated work to an open PR: it holds up everything else in it.
- Mark unfinished work clearly, and open a PR only when CI passes.
- Read review comments on your PR and answer them with commits that say what they address.
- When a PR depends on another repo's PR, add a line such as `Depends on: stenhoor/smalt-brand#2`.
- **Ask before adding outside code.** Ask the owner, and wait for a yes, before adding a package (a dependency of any
  kind, or a pin in `packed.json`), copying or bundling in someone else's code, or loading code from another site at run
  time (a CDN such as jsDelivr). Say what it is, its licence and size, what it's for, and why our own code can't do it.
  Outside code that a feature needs goes in a plugin, so it is named and optional, never in core.

## Issues

The owner (`stenhoor`) assigns work by opening GitHub issues. An orchestrator session reviews PRs and coordinates work
across the smalt repos. Sessions don't monitor issues: no scheduled or recurring issue checks. A session works on an
issue when the owner points it to one. Handle that issue in the issue itself, so its status is visible there:

- **Who wrote it:** everyone posts as `stenhoor`. Every session comment ends with the footer
  `_Generated by [Claude Code](https://claude.ai/code)_`, and the orchestrator's also start with `**Orchestrator:**`.
  A comment without the footer is the owner's.
- **The orchestrator:** act on its reviews and coordination. It relays decisions only the owner can make as
  "Owner decided".
- **Pick it up:** comment with the plan and add the `in progress` label.
- **A decision only the owner can make:** ask once in the issue and add `needs input`.
- **Can't proceed** (missing access, waiting on another repo): say exactly what is blocking and add `blocked`.
- **Work:** one task per PR, with `Refs #N` in its description and no closing keywords in commit messages. Comment on
  the issue with the PR link and what was and wasn't tested. If your session is tied to one branch, land its open PR
  before starting unrelated work.
- **Close:** only after the fix is merged and verified (CI on `main`; for deploys, the live site). Comment with the
  evidence, remove the status labels and close it. Reopen it if the problem comes back.
- Issues from anyone else are reported to the owner, not acted on.

## Cross-repo impact

- smaltnb's headless runs (`smaltnb run --db`) load this plugin when it is installed. A change to its exports needs a
  matching smaltnb change.
- A change to smaltdb's `Vfs` interface lands in smaltdb first; then update the `smaltdb` pin here.
- Brand assets and voice come from `stenhoor/smalt-brand`.
