# Changelog

## 0.2.1

Security fixes.

- git never runs a program named in a repository's own config, and the extension stays off in
  folders the editor does not trust
- AI summaries through Claude Code load no MCP servers
- The cache is readable only by your own account

## 0.2.0

First release of the editor extension.

- "Why does this line exist?" from the right-click menu, the Command Palette, a keyboard shortcut,
  or the "Why?" link above functions and classes
- Side panel with every commit, move and rename, the pull request, review comments on the file and
  linked issues, in the editor's own colours
- Unsaved and uncommitted edits are mapped back to the last commit
- GitHub sign-in through the editor's built-in login
- Optional AI summary with checked citations, using Claude Code or an Anthropic API key
