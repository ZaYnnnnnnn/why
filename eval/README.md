# Accuracy test

30 lines of real code with hand-checked answers, used to measure how often `why` finds the right
history.

## The repositories

`repos.json` pins each project to one commit, so line numbers never move:

| Project | Commits | Lines sampled from                                                                                                |
| ------- | ------- | ----------------------------------------------------------------------------------------------------------------- |
| Express | 6,186   | `lib/`                                                                                                            |
| Flask   | 5,566   | `src/flask/`                                                                                                      |
| React   | 21,791  | the core runtime packages (`react`, `react-reconciler`, `react-dom`, `react-dom-bindings`, `scheduler`, `shared`) |

Clones live in `~/.cache/why/eval` (or `$WHY_EVAL_DIR`) and are created on first use.

## How lines are picked

`pnpm eval:sample` picks 10 lines per project with a fixed random seed, so nobody chooses the
examples. A line qualifies if it is in a source file (not a test), has at least 20 characters and
is not a `//`, `/*`, `*` or `#` comment. Python docstring lines are kept: they are real lines of
the file.

## What each label means

- **`origin`**: the commit where the line first appeared doing its current job. Follow it back
  through edits, renames, moves and copies, however much the text changed. Stop when the older
  text did something unrelated.
- **`latest`**: the newest commit that changed the line in any way, including indentation, taken
  from `git blame -M -C -C` so that lines moved or copied without changes keep their real author.
  Two short Flask import lines were set by hand, because blame only recognises copies of 40 or
  more characters (their notes explain). It should be the newest step of a trace.
- **`tags`**: what makes the case hard, for example `copied`, `moved between files`,
  `identical line elsewhere`, `reformatted`.
- **`note`**: one or two sentences explaining the decision.

## How the labels were found

Not with `why`'s own method, so the test does not grade itself.

1. `git log --follow -S"<exact text>" -- <file>` finds the first commit that added the exact text
   in the line's own file (following renames).
2. Read that commit's diff. If the line replaced an older version of itself, repeat with the
   older text; if it was moved or copied from another file, continue in that file.
3. Stop at a commit where nothing earlier did the same job.

An automatic first pass of this method was wrong on about a third of the lines, mostly because of
identical text elsewhere in the file (`var router = this._router;` in two functions, seven
identical `readContext` signatures), copies (`http.js` to `proto.js`) and reformatting that split
one line into several. Every label was decided by reading the diffs, and the notes say why.

## Running

```bash
pnpm eval:sample   # re-pick the lines (keeps existing labels for unchanged picks)
```
