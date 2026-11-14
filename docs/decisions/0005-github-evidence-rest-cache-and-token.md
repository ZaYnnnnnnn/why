# 0005: GitHub evidence through the REST API, a file cache and an optional token

**Status:** accepted, Phase 3

## Context

Git history says _what_ changed. The _why_ usually lives on GitHub: the pull request description,
reviewers' comments on the file, and the issues a change closes. Phase 3 attaches that evidence to
every step of a trace, without AI.

Constraints:

- It must work with no setup at all. Without a token GitHub allows 60 requests per hour, shared by
  everything on the same network.
- It must be safe to run on any repository, and a user's token must never leak.
- Evidence will be handed to a model in Phase 4, so it has to be small and relevant.

## Decision

**REST, not GraphQL.** GraphQL could fetch a pull request, its issues and comments in fewer
requests, but it refuses every request without a token. REST works unauthenticated, so `why`
works the moment it is installed; a token only raises the limit.

**What is fetched per step:**

1. `GET /repos/{owner}/{repo}/commits/{sha}/pulls`, the pull request GitHub associates with the
   commit (merged one first). If there is none, a trailing `(#123)` in the subject, which is how
   squash merges usually look.
2. The pull request, plus its review comments filtered to the traced file only.
3. Issues linked from the commit message, the PR title and the PR description, marked `closes`
   (close/fix/resolve keywords, as GitHub itself reads them) or `mentions`, with their first
   comments.

**Keeping evidence relevant:**

- A pull request with more than 20 commits is a _batch_ (usually a release). It is shown, but
  issue links from its description are not attached to the line. Found on Express, where
  "Release 4.13" (40 commits) linked unrelated issues about etags and routing.
- Descriptions are capped at 4,000 characters and comments at 1,000; at most 5 comments and 5
  issues per step.

**Cache.** Every response is a JSON file under `$XDG_CACHE_HOME/why/github` (default
`~/.cache/why/github`), written atomically. A commit's pull request is kept forever once found;
an empty answer, pull requests and issues are refreshed after a week. `--refresh` ignores the
cache. A second run of the same trace makes no requests.

**Rate limits.** If the limit resets within a minute, or GitHub sends `retry-after`, wait and retry.
Otherwise stop linking, keep the evidence already found, and print a warning with the reset time
and a `GITHUB_TOKEN` hint. The git trace always prints. Server errors and network failures retry
three times with growing delays.

**Token and safety.**

- Read from `GITHUB_TOKEN` or `GH_TOKEN`, sent only in the `Authorization` header to
  `api.github.com`, never written to the cache, logs or output.
- Owner and repository names from remotes, `--github` or commit text are validated, and names made
  only of dots are rejected, so nothing can steer a request outside `/repos/{owner}/{repo}`.
- Tests use a fake `fetch` and a temporary cache folder; the suite never touches the network.

## Alternatives considered

- **GraphQL:** fewer requests, but unusable without a token.
- **`gh` CLI:** would need it installed and signed in, and its output format is not ours to rely on.
- **Scraping github.com pages:** fragile and against GitHub's terms.
- **No cache:** every run would spend the 60-request budget again.

## Results on real projects

| Line                                      | Evidence found                                                                                                                                            |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Express `lib/response.js:72` (RangeError) | PR #4212 with 5 review comments on the file, including "Should we continue `JSON.stringify` here…"; closes #3143, which is itself an earlier pull request |
| Express `lib/response.js:65` (res.status) | 2015 step: PR #2682 "Release 4.13", now marked as a batch of 40 commits; the 2011 steps predate pull requests and correctly have no evidence              |

Both traces together used about 22 of the 60 unauthenticated requests; rerunning them from the cache
used none. Flask was not checked live with GitHub in this phase because the hourly limit ran out.

## Consequences

- Without a token, a few traces per hour; with a free read-only token, about 5,000 requests per hour.
- Evidence for Phase 4 arrives already filtered (file-specific reviews, no batch-PR noise) and
  size-capped.
- GitHub Enterprise, GitLab and Bitbucket are not supported yet.
