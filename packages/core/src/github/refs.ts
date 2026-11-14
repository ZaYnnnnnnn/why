import type { GitHubRepo } from "./remote.ts";

export type IssueLink = "closes" | "mentions";

export interface IssueRef extends GitHubRepo {
  number: number;
  link: IssueLink;
}

const NAME = "[A-Za-z0-9_.-]+";
const REFERENCE = new RegExp(
  [
    `https?://(?:www\\.)?github\\.com/(${NAME})/(${NAME})/(?:issues|pull)/(\\d+)(?![\\w/])`,
    `(?<![\\w/.-])(${NAME})/(${NAME})#(\\d+)(?!\\w)`,
    `(?<![\\w&/#])#(\\d+)(?!\\w)`,
    `(?<![\\w-])GH-(\\d+)(?!\\w)`,
  ].join("|"),
  "g",
);
const CLOSING_KEYWORD = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+$/i;

export function findIssueRefs(text: string, self: GitHubRepo): IssueRef[] {
  const found = new Map<string, IssueRef>();

  for (const match of text.matchAll(REFERENCE)) {
    const [, urlOwner, urlRepo, urlNumber, owner, repo, crossNumber, shortNumber, ghNumber] = match;
    const ref: GitHubRepo & { number: number } = urlNumber
      ? { owner: urlOwner!, repo: urlRepo!, number: Number(urlNumber) }
      : crossNumber
        ? { owner: owner!, repo: repo!, number: Number(crossNumber) }
        : { ...self, number: Number(shortNumber ?? ghNumber) };

    if (!Number.isSafeInteger(ref.number) || ref.number < 1) continue;
    if (isDotsOnly(ref.owner) || isDotsOnly(ref.repo)) continue;

    const before = text.slice(Math.max(0, match.index - 20), match.index);
    const link: IssueLink = CLOSING_KEYWORD.test(before) ? "closes" : "mentions";
    const key = `${ref.owner.toLowerCase()}/${ref.repo.toLowerCase()}#${ref.number}`;
    const existing = found.get(key);

    if (!existing) found.set(key, { ...ref, link });
    else if (link === "closes") existing.link = "closes";
  }

  return [...found.values()];
}

function isDotsOnly(name: string): boolean {
  return /^\.+$/.test(name);
}
