# 0001: One monorepo, TypeScript source with no build step

**Status:** accepted, Phase 0

## Context

`why` will have one engine (`core`) used by several front ends: a CLI, a website, a VS Code
extension and an MCP server. They must always use the same version of the engine.

## Decision

- One repository with pnpm workspaces: `packages/*` for shared code, `apps/*` for front ends.
- Packages export their TypeScript source directly. Node 22.18+ runs `.ts` files through type
  stripping, and Vitest reads TypeScript natively, so there is no build step during development.
- Only "erasable" TypeScript syntax is allowed (no enums or namespaces), because type stripping
  removes types and cannot transform code. `erasableSyntaxOnly` in `tsconfig.base.json` enforces
  this.
- TypeScript is pinned to 6.0 because `typescript-eslint` does not support 7.x yet.

## Alternatives considered

- **Separate repositories per app:** every engine change would need releases and version bumps
  across repos. Too slow for one person.
- **Build every package with `tsc` to `dist/`:** works, but adds watch processes and stale-build
  bugs during development. We add a build only where it is required: publishing the CLI to npm
  and bundling the VS Code extension.

## Consequences

- Imports between local files need explicit `.ts` extensions.
- Publishing (Phase 6 and later) will need a bundling step for the CLI and the extension.
