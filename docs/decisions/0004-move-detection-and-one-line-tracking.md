# 0004: Our own move detection, and keeping traces on one line

**Status:** accepted, Phase 2

## Context

`git log -L` (decision 0003) follows a line inside one file and through file renames. Testing on
real projects showed two gaps:

1. **Moved code ends the trail.** When code is cut from one place and pasted in another (another
   file, or another spot in the same file), git sees "deleted here, added there". The trail
   stops at the move. Express `lib/response.js:65` (`res.status`) stopped at a 2011 "misc" commit
   that moved the block from line 149 to line 39, instead of its real origin two weeks earlier.
2. **The traced range widens.** When a commit collapses several lines into the traced line, git
   keeps tracking the whole old block from then on, so the trail fills with edits to neighbouring
   code. Express `lib/response.js:218` grew to 45 steps, most of them about other lines.

`git blame -C` is git's own move detection. In a small test it did not detect a moved function,
and it gives one answer per line, not a history.

## Decision

**Move detection (`findMovedFrom`).** When a trail reaches a commit that "added" the line, look at
every line removed in that same commit and score it:

- exact match with all whitespace ignored (so reformatted moves still count)
- otherwise a similar line (80% or more character-pair overlap), only if at least one
  neighbouring line moved with it
- short or punctuation-only lines such as `}` need two matching neighbours
- matching neighbours (3 above and below) break ties; if two sources still tie, return
  "ambiguous" and stop rather than guess

If a source is found, that step becomes **moved**, and tracing restarts from the parent commit at
the old location. At most 50 restarts, never the same position twice.

**One-line tracking.** When a step's "before" has more than one line, pick the old line most
similar to ours (at least 50%) and restart `git log -L` on that single line from the parent
commit. If none is similar enough, the line replaced unrelated code and the trail ends there.

## Alternatives considered

- **tree-sitter (parse code and match functions):** needs a grammar per language and makes the
  VS Code extension heavier. Line-plus-neighbours matching works for every language. We revisit
  this only if the Phase 4 accuracy set shows matching misses real cases.
- **`git blame -C -C`:** missed a moved function in testing, and returns one commit per line,
  not a trail.
- **Always pick the first line of a widened range:** wrong whenever our line was not the first
  line of the collapsed block (covered by a test).

## Results on real projects

Random samples of 40 non-trivial lines each:

| Project | Lines with a detected move | Ambiguous | Average time | Slowest |
| ------- | -------------------------- | --------- | ------------ | ------- |
| Express | 2                          | 1         | 244 ms       | 425 ms  |
| Flask   | 9                          | 0         | 301 ms       | 838 ms  |

Flask moves line up with their commit messages: "move \_PackageBoundObject into Scaffold",
"add url_for method to app", "Refactored package finding". Paths from before Flask's 2019 move
to `src/` are followed through the rename.

## Open questions for the Phase 4 accuracy set

- **Unrelated one-line replacements.** Git calls a line "changed" even when the old text is
  unrelated. Express 214f913 ("merge") replaced `res.send = require('response-send');` with
  `this.end(head ? null : body);` while restoring older code. Flask 1759d8e ("Added support for
  anchor link generation") added `if anchor is not None:`, but git pairs it with the unrelated
  `return ctx.url_adapter.build(...)` line it pushed down, so the trail continues into 2010 code.
  Ending trails at such steps needs a similarity threshold, which should be chosen from measured
  cases, not guessed.
- **Copies.** Code copied to a new file while the original stays (Express 3d597a5 copied
  `lib/express/*` to `lib/` and deleted the originals in a later commit) is not followed yet.
