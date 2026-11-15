# Changelog

## Unreleased

- **Security:** git never runs a program named in a repository's own config (text-conversion
  filters and fsmonitor are turned off), and the extension stays off in folders the editor does
  not trust.
- **Security:** AI summaries through `claude -p` load no MCP servers, so text in a commit or PR
  cannot steer the model into using one.
- **Security:** the cache in `~/.cache/why` is readable only by your own account.

## v0.2.0 (2026-11-15)

- **Editor extension** for VS Code, Cursor and Windsurf: right-click a line, use the shortcut, or
  click "Why?" above a function to see its history, pull requests, reviews and issues in a side
  panel that follows the editor's theme.
- **Edited files:** unsaved and uncommitted changes are mapped back to the last commit, and a line
  typed since then says it has no history yet.
- **GitHub sign-in** through the editor's own login; AI summaries with Claude Code or an Anthropic
  key kept in the editor's secret storage.
- Install by downloading `why-line-history.vsix` below and choosing "Install from VSIX…".

## v0.1.0 (2026-11-15)

The first public version.

- **Line history:** `why <file>:<line>` lists every commit that changed a line, following edits,
  file renames and moves within or between files, and stays on one line when old commits merged
  several lines into it.
- **GitHub evidence:** each step shows its pull request, the review comments on that file, and
  the issues it closes or mentions. Release pull requests are labelled as batches. Answers are
  cached, and `GITHUB_TOKEN` raises the rate limit.
- **AI summaries:** `--explain` adds a short summary in which every claim cites a real commit,
  pull request, review or issue, using your own Claude Code sign-in or an Anthropic API key.
- **Measured accuracy:** on 30 random lines from Express, Flask and React, the trail ends at the
  true origin 20 times out of 30 and never follows the wrong line.
- **Live demo:** 2,061 pre-traced lines at https://zaynnnnnnn.github.io/why/

Known gaps: copied code, lines split by reformatting, large rewrites and reverted-then-re-landed
lines are not followed yet; the live demo does not show AI summaries yet.
