# Plan

Claude builds, Zain reviews. Each phase starts only after its detailed plan is approved, ends with
a decision note and a five-question quiz, and gets one LinkedIn update.

**Budget:** $0. GitHub, Actions, Vercel and the extension marketplaces are free; the AI step runs
through `claude -p` locally, and the public demo serves pre-generated answers.

## Phase 0: Setup

- pnpm monorepo, TypeScript, ESLint, Prettier, Vitest
- GitHub Actions running lint, format check, typecheck and tests
- `@why/testkit`: generated git repos with a known history
- `CLAUDE.md`, README skeleton, MIT license, first decision notes

**Done when:** CI passes and `pnpm check` runs locally.

## Phase 1: Trace a line inside one file

- `git log -L` history for a single line, parsed into commit, author, date, message and change
- Keeps tracking the line as lines above it are added or removed
- CLI `why <file>:<line>` with readable output and `--json`

**Done when:** sensible history on a real small repo.

## Phase 2: Follow the line across moves and renames

- File renamed or moved: continue in the old path
- Code moved to another file: find the enclosing function with tree-sitter, search the commit
  for its origin, use `git blame -C` as a helper

**Done when:** a line in React traces back past at least one large refactor.

## Phase 3: Commit to pull request to issues

- Commit → pull request (GitHub API) → description, key review comments, linked issues
- Issue description and top comments
- JSON file cache; rate-limit handling with retry and backoff

**Done when:** the CLI shows the full evidence timeline without AI.

## Phase 4: AI explanation and accuracy

- Evidence bundle with an ID for every item, trimmed to fit the model
- Swappable provider: `claude -p`, Anthropic API, Gemini, Ollama
- Citations must reference bundle IDs; anything else is rejected
- Eval set: 30 hand-checked lines across React, Rails and Next.js, with a scoring script

**Done when:** the README reports a measured accuracy score.

## Phase 5: Web demo

- Script that picks about 300 interesting lines and pre-generates their answers as JSON
- Next.js static site: repo picker, file browser, timeline panel; phone-friendly, dark mode
- Deployed free on Vercel at `why.zain-dev.com`

**Done when:** the live link works on phone and laptop.

## Phase 6: Launch

- Final README: demo GIF, live link, architecture diagram, accuracy table, roadmap
- "How it works" written by Zain in his own words
- Write-up post; repo pinned on GitHub and featured on LinkedIn

## Phase 7: VS Code extension

- "Why?" link above functions plus a command for any line; timeline side panel
- Local git, VS Code's built-in GitHub sign-in, optional AI key in secret storage
- Published to the VS Code Marketplace and Open VSX

## Phase 8: MCP server (stretch)

- Lets AI coding agents ask why code exists before changing it

## Out of scope for v1

Live "try any repo" on the website, private repositories, GitLab and Bitbucket.
