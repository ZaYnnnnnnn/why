# 0006: AI explanations that may only cite the evidence

**Status:** accepted, Phase 4a

## Context

Phases 1–3 collect the evidence for a line: every commit that shaped it, the pull requests, the
review comments on the file and the linked issues. Reading all of it takes minutes. Phase 4a adds
a short explanation on top, written by a language model.

The risk with a model is that it fills gaps with plausible guesses. For a tool whose whole point is
"why does this exist?", an invented reason is worse than no answer.

## Decision

**Evidence pack with IDs.** Every source gets an ID: `C1…` for commits, `PR1…` for pull requests,
`R1…` for review comments on the file, `I1…` for issues. The pack is plain text, capped at about
12,000 tokens; when it is too big it drops issue comments, then review comments, then shortens
descriptions, and never drops a commit.

**Every claim must cite.** The model returns JSON: a summary, a timeline (oldest first), a
confidence level and a list of gaps. The summary and every timeline entry must cite at least one
ID, and every ID must exist in the pack. If not, the model gets one retry with the exact problems.
If it fails again, the CLI shows the plain evidence timeline and says why; unchecked claims are
never shown.

**Gaps instead of guesses.** The prompt asks the model to list what the evidence does not say. In
practice this is the most useful part of many answers: for Express `res.status` it reports that
the 2015 commit never explains why the function was given a name, instead of inventing a reason.

**Untrusted text.** Commit messages, PR descriptions and comments are written by anyone. The
prompt marks them as data, text that tries to close the evidence block is neutralised, the model
runs with no tools, and the citation check rejects claims that point at nothing.

**Providers.**

- `claude -p` (default): the user's own Claude Code sign-in, so a Max plan costs nothing extra.
  Tools off, no saved session, run in an empty temp folder so the traced repo's `CLAUDE.md` and
  settings are never loaded, evidence on stdin. `ANTHROPIC_API_KEY` is removed from its
  environment so it cannot silently bill an API key. Falls back to `~/.local/bin/claude` when the
  command is not on PATH.
- Anthropic API (`--ai anthropic`): for people with their own key. Default `claude-opus-5-5` at
  medium effort, JSON through `output_config.format`, server-side refusal fallback on.

Answers are cached by prompt version, provider, model and pack text, so asking again is instant.

## Alternatives considered

- **Let the model write freely and trust it:** fastest to build, but nothing stops invented
  reasons.
- **Retrieval over embeddings (classic RAG):** the evidence for one line is small and already
  exactly the right set, so search adds nothing but a way to miss things.
- **Gemini or Ollama adapters now:** the interface makes them a small addition; built only when
  something needs them.

## Results on real lines

Each run is one `claude -p` request of about 10–17 seconds; a cached rerun takes about 1 second.

| Line                                           | Confidence | What the explanation found                                                                                                                                                                                                                                               |
| ---------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Express `lib/response.js:72` (RangeError)      | high       | Invalid codes made Node throw inside `writeHead` and left requests hanging (from the earlier PR #3143); the range matches Node.js (PR #4212); reviewers asked for strings to throw and for `JSON.stringify` in the message. Gap: why 100–999 rather than HTTP's 100–599. |
| Express `lib/response.js:65` (res.status)      | medium     | Added in 2011 for chaining, moved in a "misc" commit, named in a 2015 perf commit that shipped in the 4.13 release. Gap: why it was given a name.                                                                                                                        |
| Flask `src/flask/app.py:1261` (url_for anchor) | high       | Anchor support from 2011, moved to the app object for #4568 in PR #4580, renamed to `_anchor` when build arguments became keyword-only. Gap: why the underscore prefix.                                                                                                  |

## Problems found by the first real runs, and fixed

1. **A long feature PR was treated as a release batch.** PR #4212 has 30 commits, so the Phase 3
   rule (more than 20 commits) hid its description. A PR is now a batch only if the traced commit
   also does not mention the PR's number; a squash merge such as "… (#4212)" is the PR itself.
2. **IDs inside sentences.** The model wrote "(C3)" in its prose. The prompt now keeps IDs in the
   citation lists only, and the CLI turns any stray IDs into readable labels.
3. **Repeated labels** in one citation list are removed.

## Consequences

- `why <file>:<line> --explain` gives a short, cited answer above the evidence timeline.
- A wrong answer can still happen inside the rules (a true citation attached to a weak claim).
  Phase 4b measures how often, with hand-checked lines and a written rubric.
