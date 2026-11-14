import { createRepo, type TestRepo } from "@why/testkit";
import { afterEach, describe, expect, it } from "vitest";
import { findGitHubRepo, parseGitHubRemote, parseRepoSlug } from "../../src/index.ts";

const repos: TestRepo[] = [];

function repo(): TestRepo {
  const r = createRepo([{ message: "init", files: { "a.txt": "a\n" } }]);
  repos.push(r);
  return r;
}

afterEach(() => {
  while (repos.length > 0) repos.pop()?.cleanup();
});

describe("parseGitHubRemote", () => {
  it.each([
    "https://github.com/expressjs/express.git",
    "https://github.com/expressjs/express",
    "https://github.com/expressjs/express/",
    "http://www.github.com/expressjs/express.git",
    "https://someone@github.com/expressjs/express.git",
    "git@github.com:expressjs/express.git",
    "git@github.com:expressjs/express",
    "ssh://git@github.com/expressjs/express.git",
    "ssh://git@github.com:22/expressjs/express.git",
    "git://github.com/expressjs/express.git",
  ])("reads %s", (url) => {
    expect(parseGitHubRemote(url)).toEqual({ owner: "expressjs", repo: "express" });
  });

  it("keeps dots and dashes in names", () => {
    expect(parseGitHubRemote("git@github.com:my-org/my.repo-name.git")).toEqual({
      owner: "my-org",
      repo: "my.repo-name",
    });
  });

  it.each([
    "https://gitlab.com/group/project.git",
    "https://github.company.com/team/app.git",
    "https://notgithub.com/a/b.git",
    "https://github.com/onlyowner",
    "https://github.com/a/b/c",
    "/local/path/to/repo",
    "https://github.com/../etc",
    "git@github.com:owner/...git",
  ])("ignores %s", (url) => {
    expect(parseGitHubRemote(url)).toBeUndefined();
  });
});

describe("parseRepoSlug", () => {
  it("reads owner/repo", () => {
    expect(parseRepoSlug("pallets/flask")).toEqual({ owner: "pallets", repo: "flask" });
  });

  it.each(["flask", "a/b/c", "../x", "owner/..", "owner/.git", "owner/repo name"])(
    "rejects %s",
    (slug) => {
      expect(() => parseRepoSlug(slug)).toThrow(/owner\/repo/);
    },
  );
});

describe("findGitHubRepo", () => {
  it("prefers upstream over origin so forks resolve to the original project", async () => {
    const r = repo();
    r.git("remote", "add", "origin", "git@github.com:someone/express.git");
    r.git("remote", "add", "upstream", "https://github.com/expressjs/express.git");

    expect(await findGitHubRepo(r.path)).toEqual({ owner: "expressjs", repo: "express" });
  });

  it("falls back to any GitHub remote", async () => {
    const r = repo();
    r.git("remote", "add", "origin", "https://gitlab.com/me/app.git");
    r.git("remote", "add", "mirror", "git@github.com:me/app.git");

    expect(await findGitHubRepo(r.path)).toEqual({ owner: "me", repo: "app" });
  });

  it("returns undefined when no remote is on GitHub", async () => {
    const r = repo();
    expect(await findGitHubRepo(r.path)).toBeUndefined();
    r.git("remote", "add", "origin", "https://gitlab.com/me/app.git");
    expect(await findGitHubRepo(r.path)).toBeUndefined();
  });
});
