# 0003: Use `git log -L` to follow a line through history

**Status:** accepted, Phase 1

## Context

To answer "why does this line exist?" we first need every commit that changed the line. The line's
number moves over time as code above it is added or removed, so we cannot just watch line 42.

## Decision

Run `git log -L<n>,<n>:<path> <rev>` once and parse its output.

Git maps the line range backwards through each commit's diff, so it follows the line as it moves
up and down the file and only reports commits that actually changed it. We ask for a custom format
with ASCII record (`0x1e`) and field (`0x1f`) separators so commit messages with any text parse
safely. Diff headers (`---`, `+++`) are only read before the `@@` hunk marker, because a code line
such as `-- comment` shows up as `--- comment` once it is removed.

## Alternatives considered

- **Repeated `git blame`:** blame the line, then blame the same line in that commit's parent,
  and so on. It needs one git call per step and we would have to map the line number across each
  diff ourselves, which is exactly what `-L` already does inside git.
- **Reading every commit that touched the file:** simple, but large files have thousands of
  commits that never touched our line.
- **A git library (isomorphic-git, nodegit):** no line-range history, and a native module would
  make the VS Code extension harder to ship.

## Consequences

- One git process per trace; Express (6,000+ commits) traces in under half a second.
- `-L` only follows the line inside one file. Moves to other files are Phase 2.
- When a commit rewrites a block of lines (for example reformatting), git can pair the old and new
  lines so the tracked line looks newly added. Found on Express: `res.status` appears to start in
  a 2011 "misc" reformat commit, but it was written two weeks earlier. Detecting and continuing
  past these false origins is planned for Phase 2.
