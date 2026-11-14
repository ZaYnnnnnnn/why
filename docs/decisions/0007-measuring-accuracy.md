# 0007: Measuring accuracy on 30 hand-checked lines

**Status:** accepted, Phase 4b (trail accuracy; AI explanation grading comes later)

## Context

By Phase 4a, `why` had been checked on a handful of lines chosen while building it. That says
little about how often it is right on lines nobody picked, and two open questions from Phases 2
and 3 needed data rather than guesses: when should a trail stop at a step where git pairs a line
with unrelated old code?

## Decision

**A fixed test set** (`eval/`): 10 lines each from Express (6,186 commits), Flask (5,566) and
React (21,791), picked by a seeded random sample from source files, with every repository pinned
to one commit.

**Labels found by a different method from `why`'s.** `git log --follow -S` on the exact text,
then reading every diff by hand. The rule: the origin is where the line first appeared doing its
current job, following edits, renames, moves and copies. Copies are included on purpose, because
`why` does not follow them yet and the test should show that. An automatic first pass of this
method was wrong on about a third of the lines (identical text elsewhere in the file, copies,
reformatting), so every label was decided by reading the diffs, with a note saying why.

**What is scored** (`pnpm eval`): whether the trail ends exactly at the origin, how it misses
(stopped early, went too far, wrong path), whether the newest step is the last commit that touched
the line, and the time per line.

**A cut-off for unrelated replacements.** When a one-line step's old text is less than 50% similar
to the new text, the trail ends there. The same floor applies when several old lines are narrowed
to one. Chosen with a sweep (`pnpm eval --sweep`):

| Cut-off | 0   | 0.1 | 0.2–0.5 | 0.55 | 0.6 | 0.65 | 0.7 | 0.8 |
| ------- | --- | --- | ------- | ---- | --- | ---- | --- | --- |
| Origins | 19  | 19  | 20      | 21   | 21  | 20   | 18  | 16  |

0.55 and 0.6 score one line more than 0.5, but that single line (Express `maxAge`, similarity 0.51)
is not enough to choose a setting on, and on short lines the score is jumpy:
`res.status = 1;` to `res.status = validate(code);` is clearly the same line but scores 0.54.
0.5 is still an improvement over no cut-off, matches the Phase 2 narrowing floor, and sits well
away from the drop that starts at 0.65.

## Results

| Measure               | Result                                     |
| --------------------- | ------------------------------------------ |
| Origin correct        | **20/30 (67%)** (19/30 before the cut-off) |
| Latest change correct | 30/30                                      |
| Wrong path            | 0                                          |
| Time per line         | median 571 ms, slowest 1.6 s (React)       |

| Kind of history                                   | Correct |
| ------------------------------------------------- | ------- |
| File renamed                                      | 3/3     |
| Identical line elsewhere in the file              | 4/4     |
| Multi-line statement                              | 2/2     |
| Docstring                                         | 2/2     |
| Edited                                            | 9/15    |
| Reformatted (one line split into several)         | 1/3     |
| Copied to another file                            | 0/2     |
| Moved between files and edited in the same commit | 0/2     |
| Rewritten                                         | 0/2     |
| Reverted and re-landed                            | 0/1     |

Every miss stops early or goes too far; none follows the wrong line. The full table is in
`eval/results.md`.

## The 10 misses

- **Copies (2):** Express copied `http.js` into `proto.js` and `lib/express/*` into `lib/`, and
  deleted the originals in later commits. `why` only follows moves inside one commit.
- **Restructured with new neighbours (1):** in 2014 Express moved the "strict routing" line inside
  `application.js` from `this._router.strict = this.enabled(...)` into the Router options object.
  The old and new lines are 79% similar, but every neighbouring line changed, so the move detector
  does not accept the match. (Earlier, in 2011, the setting had also moved from the router file.)
- **Rewritten (2):** Express `res.type` (a ternary rewritten into `var ct = ...`) and Flask's type
  alias rewritten into a multi-line `Union`, where git paired the new line with a similar
  neighbouring alias it did not replace (this one goes too far).
- **Reformatted (2):** Flask import lists and the shell banner were split into one line per item;
  the trail ends at the split.
- **Moved within a file with an edit (1):** a Flask import moved from inside a method to the top
  of the module and changed at the same time.
- **Unrelated old text above the cut-off (1):** Express `maxAge` (0.51) goes one step too far.
- **Reverted and re-landed (1):** React's profiler line was added, reverted the next day and
  re-landed as a "second try"; `why` stops at the re-land, which is where the line's continuous
  history starts.

## Consequences

- The README can state a measured number instead of a claim, with its limits.
- The misses point at the next improvements, in order of how many lines they would fix: following
  copies, matching reformatted lines that were split, and moves whose neighbours changed.
- The same 30 lines will grade the AI explanations once a Claude plan is connected; that part of
  Phase 4b is deferred, not dropped.
- The cut-off was chosen on these same 30 lines, so 67% is likely a little optimistic. A second,
  fresh sample would confirm it.
