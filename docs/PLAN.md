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

- File renamed or moved: `git log -L` already follows renames; tested and shown in the CLI
- Code moved to another file or another spot in the same file: our own move detection
  (`findMovedFrom`), matching removed lines plus their neighbours. tree-sitter and
  `git blame -C` were dropped; see decision 0004
- Keep traces on one line when `git log -L` widens the tracked range (found while testing)

**Done:** tested on Express and Flask instead of React (React's full history is a very large
clone; it stays in scope for the Phase 4 accuracy set and the Phase 5 demo). Express `res.status`
now reaches its real origin past a 2011 move; Flask traces past its 2019 move to `src/` and its
2021 and 2023 refactors. Open questions for Phase 4 are listed in decision 0004.

## Phase 3: Commit to pull request to issues

- Commit → pull request (GitHub REST API) → description, review comments on the traced file,
  linked issues (closes / mentions) with their first comments
- Release pull requests with more than 20 commits are shown but their issue links are skipped
- JSON file cache; rate-limit handling with retry and backoff; optional `GITHUB_TOKEN`

**Done:** the CLI shows the evidence timeline without AI (decision 0005). Checked live on two
Express lines without a token and two Flask lines with one.

## Phase 4: AI explanation and accuracy

Split into two parts reviewed separately.

### 4a: AI explanation (done)

- Evidence pack with an ID for every item, trimmed to fit the model
- Swappable provider: `claude -p` (default, the user's Claude Code sign-in) and the Anthropic API;
  Gemini and Ollama only when needed
- Every claim must cite pack IDs; one retry, then the plain timeline instead of unchecked claims
- `--explain` in the CLI; answers cached. See decision 0006 for real results

### 4b: Accuracy (trail part done)

- Eval set: 30 lines from Express, Flask and React chosen by a fixed random seed
- True origins found independently (`git log --follow -S` and reading diffs), for Zain to review
- Result: origin 20/30 (67%), latest change 30/30, no wrong paths (decision 0007)
- Similarity cut-off for unrelated one-line replacements chosen from the data: 0.5
- **Deferred to the end:** grading the AI explanations on the same 30 lines, once Zain connects
  his own Claude plan to the `claude` CLI

**Done when:** the README reports a measured accuracy score.

## Phase 5: Web demo

- Generator traces every answerable line of chosen files: 2,061 lines from Express, Flask and
  React (instead of the planned ~300 hand-picked lines)
- Next.js static site: project pages, code view with clickable lines, history panel (side panel
  or bottom sheet), `#L` links, dark and light theme
- Deployed free on GitHub Pages at https://zaynnnnnnn.github.io/why/ (instead of Vercel, so no
  extra account); `why.zain-dev.com` can be added later with one DNS record
- AI explanations left out until a Claude plan is connected

**Done:** live and checked on laptop and narrow window sizes (decision 0008).

## Phase 6: Launch

- Final README: demo GIF, live link, real CLI output, architecture diagram, accuracy table,
  usage, decision index, roadmap
- "How it works": written by Claude at Zain's request, as a summary in the README and a full
  walk-through in `docs/how-it-works.md` that doubles as his study guide
- Link-preview image for sharing the demo; release v0.1.0
- Repo pinned on GitHub with its About text (Zain)
- **Moved to the end:** the LinkedIn post and LinkedIn Featured, once AI summaries are connected

## Phase 7: VS Code extension

- "Why?" link above functions plus a command, right-click menu and shortcut; timeline side panel
- Unsaved and uncommitted edits mapped back to the last commit (`mapToCommittedLine`)
- Local git, the editor's built-in GitHub sign-in, optional AI key in secret storage
- `.vsix` built in CI and attached to GitHub releases by a version tag
- **Later (Zain's accounts):** publishing to the VS Code Marketplace and Open VSX

**Hand test checklist** (VS Code and Cursor):

1. Install `apps/vscode/why-line-history.vsix` with "Extensions: Install from VSIX…"
2. Open a file in a git repository from GitHub, right-click a line → "Why does this line exist?"
   → the panel opens beside the code with the line's history
3. Click "Why?" above a function → its declaration line's history
4. Press Ctrl+Cmd+H (Mac) or Ctrl+Alt+H on another line
5. Add two lines at the top without saving, then ask about a line below → same history as before;
   ask about one of the new lines → "Not committed yet"
6. Click a PR or commit link → it opens on GitHub in the browser
7. Click "Sign in to GitHub" in the panel → the editor's GitHub login, then the panel reloads
8. Switch between a light and a dark theme → the panel follows
9. Turn off `why.codeLens.enabled` in settings → the "Why?" links disappear

**Done:** all nine checks passed by hand in VS Code on 2026-11-15, on Express and on a private Rails
repository (decision 0009). The hand test caught one bug, a new line typed over a blank line
reported as "modified", fixed before release. The editor was already signed in to GitHub, so
check 7 passed without a prompt. Not yet tried in Cursor. Released as
[v0.2.0](https://github.com/ZaYnnnnnnn/why/releases/tag/v0.2.0) with the `.vsix` attached.

## Phase 8: MCP server (stretch)

- Lets AI coding agents ask why code exists before changing it

## Out of scope for v1

Live "try any repo" on the website, private repositories, GitLab and Bitbucket.
