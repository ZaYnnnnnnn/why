# why

**Ask any line of code why it exists.**

`why` follows a line back through its whole history, across edits, file moves and renames. It
connects every change to its pull request and the issues behind it, then writes a short timeline
that links to every source it used.

**Live demo: [zaynnnnnnn.github.io/why](https://zaynnnnnnn.github.io/why/)**. Click any marked
line in Express, Flask or React to see why it exists.

> **Status:** under construction, Phase 4 of 8 done. Next: the web demo. See the [roadmap](#roadmap).

## What it will look like

```text
$ why src/router.ts:142

src/router.ts:142  →  if (path.endsWith("/")) path = path.slice(0, -1);

2019-03-04  Added in #1203 "Fix duplicate route matches"
            Trailing slashes made /users and /users/ register as two routes (issue #1188).
2021-07-19  Moved from lib/match.ts to src/router.ts in #2410 "Split router into modules"
2023-01-09  Kept during the rewrite in #3877, which added a test for this case

Sources: 3 pull requests, 2 issues, 5 commits
```

_This output is an illustration of the goal, not real data._

## Accuracy

Measured on 30 lines from Express, Flask and React, picked at random and labelled by hand with a
different method from the one `why` uses (see [`eval/`](eval)):

| Measure                                              | Result          |
| ---------------------------------------------------- | --------------- |
| Trail ends at the true origin                        | **20/30 (67%)** |
| Newest step is the last commit that touched the line | 30/30           |
| Trail follows the wrong line                         | 0/30            |
| Time per line                                        | median 0.6 s    |

It handles renames, identical lines elsewhere in a file and multi-line statements. It does not yet
follow code that was copied to a new file, lines that were split during reformatting, or a line
that was reverted and re-landed; those are the misses. Details in
[decision 0007](docs/decisions/0007-measuring-accuracy.md).

## How it works

_To be written in Phase 6._

## Roadmap

- [x] **Phase 0:** repo setup, CI, test-repo generator
- [x] **Phase 1:** trace a line through edits in one file (CLI)
- [x] **Phase 2:** follow the line across moves and renames
- [x] **Phase 3:** connect commits to pull requests and issues
- [x] **Phase 4:** AI explanation with citations, plus a measured accuracy score
- [ ] **Phase 5:** web demo with pre-generated answers for well-known repos
- [ ] **Phase 6:** launch
- [ ] **Phase 7:** VS Code extension (also works in Cursor and Windsurf)
- [ ] **Phase 8:** MCP server so AI coding agents can ask "why" before changing code

## Development

Requires Node 22.18+ and pnpm.

```bash
pnpm install
pnpm check
```

Try the CLI from inside any git repository:

```bash
node /path/to/why/apps/cli/src/main.ts lib/response.js:65
```

Options: `--json` for machine-readable output, `--rev <rev>` to start from an older commit,
`--repo <path>` to run against another folder, `--github <owner/repo>` to choose the GitHub
repository, `--no-github` for git history only, `--refresh` to ignore cached GitHub answers.

When the repository is on GitHub, each step also shows its pull request, reviewers' comments on
that file and the issues it closes or mentions. It works without setup (GitHub allows 60 requests
an hour); set `GITHUB_TOKEN` to a read-only token for 5,000. Answers are cached in
`~/.cache/why/github`.

Add `--explain` for a short AI explanation above the timeline. Every claim must cite the evidence
it comes from, the model lists what the evidence does not say instead of guessing, and an answer
that fails these checks is not shown. It uses your own Claude Code sign-in (`claude -p`) by
default, or `--ai anthropic` with `ANTHROPIC_API_KEY`.

```text
$ why lib/response.js:72 --explain

Why
  This line makes res.status throw a RangeError when the status code is below 100 or above 999.
  Node.js itself throws outside that range, and Express 5 wanted to catch such codes up front.
  Before this, a bad code such as err.code could leave a request hanging. (723b545, PR #4212,
  PR #3143, review by @blakeembrey on PR #4212)

  Confidence: high
  Not in the evidence: why the team settled on Node's 100-999 range instead of the 100-599
  range of standard HTTP status codes.
```

`pnpm check` runs lint, formatting, type checks and tests. Design decisions are recorded in
[`docs/decisions`](docs/decisions).

## License

[MIT](LICENSE)
