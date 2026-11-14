# 0002: Test against generated git repos, not real ones

**Status:** accepted, Phase 0

## Context

Almost every feature of `why` reads git history. Tests need repos where we know exactly what
happened: which commit added a line, when a file was renamed, when code moved.

## Decision

`@why/testkit` exposes `createRepo(history)`. It takes a list of commits (file changes, renames,
deletions, optional author and date) and builds a real git repo in a temp folder.

To make results repeatable:

- Author and committer dates are fixed (one day apart from 2020-01-01 unless given).
- The user's own git config is ignored (`GIT_CONFIG_GLOBAL` points to the null device), so
  settings like commit signing or hooks on the developer's machine cannot change the result.
- The same history always produces the same commit hashes, so tests can assert on exact hashes.

## Alternatives considered

- **Clone real projects in tests:** slow, needs network, and their history keeps changing.
- **Commit fixture repos into this repo:** nested `.git` folders are awkward to store and review,
  and the history is hidden instead of readable in the test.
- **Mock git output:** fast, but it would test our assumptions about git rather than git itself.

## Consequences

- Tests need the `git` binary installed (it is on GitHub Actions runners by default).
- Real-repo checks (React, Rails, Next.js) happen in the eval set in Phase 4, not in unit tests.
