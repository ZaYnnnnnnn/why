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

### 4b: Accuracy

- Eval set: 30 lines from Express, Flask and React chosen by a fixed random seed
- True origins found independently (`git log -S` and reading diffs), reviewed by Zain
- Scores: origin accuracy, drift, citation validity, rubric-graded explanation quality
- Choose the similarity cut-off for unrelated one-line replacements from the data

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
