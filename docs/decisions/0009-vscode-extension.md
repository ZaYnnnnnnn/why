# 0009: A VS Code extension that also runs in Cursor and Windsurf

**Status:** accepted, Phase 7

## Context

Developers read code in their editor, not on a website. Asking "why does this line exist?" should
be a right-click away, on their own code, including code they are in the middle of changing.

## Decision

**One extension for VS Code 1.90 and later.** Cursor and Windsurf are built on VS Code and install
the same `.vsix` file, so one package covers all three.

**Four ways in:** the right-click menu, the Command Palette, a shortcut (Ctrl+Alt+H, or Ctrl+Cmd+H
on Mac), and a **Why?** link above every function and class. The links come from the editor's own
outline of the file (document symbols), so they work in any language the editor understands and
`why` needs no parser of its own.

**Edited files are mapped back to the last commit.** The editor shows the current text, often with
unsaved or uncommitted changes; git only knows the last commit. `mapToCommittedLine` in the core
package diffs the committed file against the editor's text with `git diff --no-index` and walks
the hunks: lines below an edit shift, lines inside one are "not committed yet". Without this, any
edit above a line would silently show the history of a different line.

**The panel is the website's timeline in the editor's colours.** It is a webview built from plain
functions that are tested without the editor. Every piece of git and GitHub text is HTML-escaped,
the page has a strict content security policy with a script nonce, and links only open if they
start with `https://`.

**Sign-in and secrets use the editor's own systems.** GitHub uses the editor's built-in GitHub
login (asked for only when the user clicks), so there is no token to paste. An Anthropic key is
kept in the editor's secret storage, never in settings. Nothing is sent to an AI unless the user
presses **Explain with AI**.

**Shared cache.** The extension uses the same cache folder as the command-line tool, so a line
looked up in one is instant in the other.

**Packaged as one file.** esbuild bundles the extension and the core package into
`dist/extension.cjs` (453 KB); the `.vsix` is 130 KB. CI builds it on every push, and a version
tag attaches it to the GitHub release.

## Alternatives considered

- **A language server:** more portable to other editors, but far more work and nothing it would
  add here; every editor that matters for this project runs VS Code extensions.
- **Tree-sitter for the "Why?" links:** needs a grammar per language; the editor already knows
  where functions are.
- **Publishing to the marketplaces now:** needs a Microsoft publisher account and an Eclipse
  (Open VSX) account. Installing from the GitHub release works today; the marketplaces can come
  later with no code changes.

## Testing

- Automated: the line mapping (added, removed, shifted, edited and unknown files), the lookup
  against generated repositories with a fake GitHub, the panel HTML including escaping, and a
  check that the bundle loads and registers its commands and links.
- By hand, in VS Code and Cursor: the checklist in `docs/PLAN.md` under Phase 7. The editor's
  interface cannot be driven from the automated tests here.

## Consequences

- `why` works on any local git repository, private ones included, with no setup beyond `git`.
- A future MCP server (Phase 8) can reuse `lookUpLine` the same way.
