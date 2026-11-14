# CLAUDE.md

Rules for building `why`. Claude writes the code, Zain reviews every change.

## What this project is

`why` answers "why does this line of code exist?" It traces a line back through git history
(edits, moves, renames), connects each commit to its pull request and linked issues, and then
writes a short timeline that cites only the evidence it found.

The full plan lives in `docs/PLAN.md`. Work one phase at a time and never start a phase before
Zain approves its detailed plan.

## Layout

- `packages/core`: tracing, GitHub linking, evidence bundling, AI explanation, cache (from Phase 1)
- `packages/testkit`: builds small git repos with a scripted history for tests
- `apps/cli`, `apps/web`, `apps/vscode`: thin layers over `core` (later phases)
- `docs/decisions`: one short note per significant decision
- `eval`: hand-checked cases and the accuracy script (Phase 4)

## How to work

- Keep each change small enough to review in about 15 minutes: one feature per pull request.
- Every behaviour change comes with tests. Use `@why/testkit` to build repos with a known history
  instead of depending on real repositories.
- Run `pnpm check` (lint, format, typecheck, tests) before calling anything done.
- Write a decision note in `docs/decisions/` for any choice someone could reasonably ask "why?"
  about in an interview. Keep it short: context, decision, alternatives, consequences.
- No explanatory comments in code. Put the reasoning in the decision note or the commit message.
- Commit messages describe what changed and why. No AI attribution trailers.
- Stay inside the current phase. Ideas for later go in the roadmap, not the code.
- After each phase, quiz Zain with five questions on how that part works.

## Technical rules

- TypeScript everywhere, ESM, Node 22.18+ (runs `.ts` files directly through type stripping).
- Import local files with explicit `.ts` extensions.
- Only erasable TypeScript syntax: no enums, no namespaces, no parameter properties.
- Shell out to the real `git` binary with `execFileSync` / `execFile` and an argument array, never
  a shell string.
- The AI step must cite evidence IDs from the bundle; reject any citation that is not in it.
