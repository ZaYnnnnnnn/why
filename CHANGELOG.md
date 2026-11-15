# Changelog

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
