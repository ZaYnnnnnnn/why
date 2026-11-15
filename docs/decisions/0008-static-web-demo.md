# 0008: A static web demo with pre-traced lines

**Status:** accepted, Phase 5

## Context

A recruiter or engineer should be able to see what `why` does in seconds, on a phone, without
installing anything. Running `why` live needs a server that clones repositories and calls GitHub,
which costs money and needs care against abuse. The budget is $0.

## Decision

**Trace ahead of time, serve static files.** `apps/web/scripts/generate.ts` traces every
answerable line of a chosen set of files at the pinned commits used by the accuracy test, links
each step to GitHub, and writes JSON. The site is a Next.js static export built from that JSON and
published to GitHub Pages by a workflow on every push to `main`.

| Project | Files                                                      | Traced lines |
| ------- | ---------------------------------------------------------- | ------------ |
| Express | all six files in `lib/`                                    | 894          |
| Flask   | `helpers.py`, `blueprints.py`                              | 535          |
| React   | `ReactHooks.js`, the Scheduler, `CSSPropertyOperations.js` | 632          |

Generating 2,061 lines took about 10 minutes and about 2,800 GitHub requests with a token.

**Data shaped for the browser.** Per project: an index, one file per source file (the source and
an answer per line), and one shared table of commits, pull requests and issues, so a commit that
touched hundreds of lines is stored once. Total: 3.3 MB of JSON.

**Light pages.** Syntax colouring is done at build time by Shiki. Each distinct colour pair gets a
short class name with one style block per page instead of inline styles on every word, which cut
Express `response.js` from 2.1 MB to 800 KB of HTML (60 KB compressed). The history panel loads a
file's answers and the project's shared table only when a line is first clicked.

**Phone first.** The panel is a bottom sheet on narrow screens and a side panel on wide ones; the
selected line scrolls above the sheet. `#L72` links open straight to a line, which makes lines easy
to share.

**No AI in the demo yet.** Phase 4a's explanations need a connected Claude account. The data
format leaves room for an explanation per line, to be generated and added later without changing
the site's structure.

## Alternatives considered

- **A live server** ("try any repository"): the most impressive, but it costs money, needs rate
  limiting and abuse protection, and is slower per line. Kept on the roadmap.
- **Vercel:** also free, but needs a separate account; GitHub Pages works from the repository
  itself.
- **Highlighting in the browser:** less HTML, but a large JavaScript download and a flash of
  uncoloured code on slow phones.

## Checked on the live site

- Home page, project pages and file pages for all three projects load with no console errors.
- `#L72` on Express `response.js` opens the line with PR #4212, its five review comments on the
  file, "closes PR #3143" and the Express 5 discussion.
- Express `res.status` (line 65) shows the 2015 rename with the "Release 4.13" batch label, the
  2011 move from line 149 and the 2011 origin.
- Dark and light themes, and the narrowest window Chrome allows (606 px). Two problems found there
  and fixed: the selected line was hidden behind the bottom sheet, and the header did not line up
  with the code.

## Consequences

- The demo is free to host and has nothing to attack or keep running.
- Adding a file or project means editing `apps/web/demo.json` and running the generator.
- The demo shows the code as it was at the pinned commits, not the latest version.
