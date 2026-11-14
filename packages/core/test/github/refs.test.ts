import { describe, expect, it } from "vitest";
import { findIssueRefs } from "../../src/index.ts";

const self = { owner: "expressjs", repo: "express" };
const refs = (text: string) => findIssueRefs(text, self);
const numbers = (text: string) => refs(text).map((r) => r.number);

describe("findIssueRefs", () => {
  it("reads closing keywords as strong links", () => {
    for (const keyword of [
      "Closes",
      "closed",
      "close",
      "Fixes",
      "fix",
      "fixed",
      "Resolves",
      "resolved",
    ]) {
      expect(refs(`${keyword} #3143`)).toEqual([{ ...self, number: 3143, link: "closes" }]);
    }
    expect(refs("Fixes: #12")).toEqual([{ ...self, number: 12, link: "closes" }]);
  });

  it("reads other references as mentions", () => {
    expect(refs("Follow-up to #4212, see also #3143.")).toEqual([
      { ...self, number: 4212, link: "mentions" },
      { ...self, number: 3143, link: "mentions" },
    ]);
  });

  it("reads references to other repositories", () => {
    expect(refs("Fixes pillarjs/send#123 and mentions nodejs/node#5")).toEqual([
      { owner: "pillarjs", repo: "send", number: 123, link: "closes" },
      { owner: "nodejs", repo: "node", number: 5, link: "mentions" },
    ]);
  });

  it("reads full issue and pull request URLs", () => {
    expect(
      refs(
        "closes https://github.com/expressjs/express/issues/3143 via https://github.com/pallets/flask/pull/5127",
      ),
    ).toEqual([
      { ...self, number: 3143, link: "closes" },
      { owner: "pallets", repo: "flask", number: 5127, link: "mentions" },
    ]);
  });

  it("reads GH-123 style references", () => {
    expect(numbers("Regression from GH-701")).toEqual([701]);
  });

  it("keeps one entry per issue and upgrades it to closes when any mention closes it", () => {
    expect(refs("See #12. Fixes #12. Also #12")).toEqual([{ ...self, number: 12, link: "closes" }]);
    expect(refs("Fixes #12 and https://github.com/expressjs/express/issues/12")).toHaveLength(1);
  });

  it.each([
    ["colour codes", "color: #fff; background: #000"],
    ["URL fragments", "https://example.com/docs#123 and https://example.com/#456"],
    ["HTML entities", "it&#39;s"],
    ["words glued to the number", "#123abc and abc#123"],
    ["markdown headings", "## 2 Changes"],
    ["issue zero", "#0"],
    ["other GitHub pages", "https://github.com/expressjs/express/commit/123"],
    ["dot-only names", "see ../..#5 and https://github.com/../x/issues/3"],
  ])("ignores %s", (_name, text) => {
    expect(refs(text)).toEqual([]);
  });

  it("does not read a keyword from a different sentence as closing", () => {
    expect(refs("This fixes a crash.\nRelated: #9")).toEqual([
      { ...self, number: 9, link: "mentions" },
    ]);
  });
});
