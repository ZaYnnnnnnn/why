import { WhyError } from "../errors.ts";
import { runGit } from "../git.ts";

export interface GitHubRepo {
  owner: string;
  repo: string;
}

const NAME = "[A-Za-z0-9_.-]+";
const REMOTE_PATTERNS = [
  new RegExp(`^(?:https?|git)://(?:[^@/]+@)?(?:www\\.)?github\\.com/(${NAME})/(${NAME})/?$`),
  new RegExp(`^ssh://(?:[^@/]+@)?github\\.com(?::\\d+)?/(${NAME})/(${NAME})/?$`),
  new RegExp(`^(?:[^@/]+@)?github\\.com:(${NAME})/(${NAME})/?$`),
];
const SLUG = new RegExp(`^(${NAME})/(${NAME})$`);
const PREFERRED_REMOTES = ["upstream", "origin"];

export function parseGitHubRemote(url: string): GitHubRepo | undefined {
  for (const pattern of REMOTE_PATTERNS) {
    const match = pattern.exec(url.trim());
    if (match) return toRepo(match[1]!, match[2]!);
  }
  return undefined;
}

export function parseRepoSlug(slug: string): GitHubRepo {
  const match = SLUG.exec(slug.trim());
  const repo = match ? toRepo(match[1]!, match[2]!) : undefined;
  if (!repo) {
    throw new WhyError(
      "INVALID_ARGUMENT",
      `Expected a GitHub repository like owner/repo, got "${slug}"`,
    );
  }
  return repo;
}

export async function findGitHubRepo(root: string): Promise<GitHubRepo | undefined> {
  const remotes = (await runGit(root, ["remote"])).split("\n").filter(Boolean);
  const ordered = [
    ...PREFERRED_REMOTES.filter((name) => remotes.includes(name)),
    ...remotes.filter((name) => !PREFERRED_REMOTES.includes(name)),
  ];

  for (const name of ordered) {
    const url = await runGit(root, ["remote", "get-url", name]);
    const repo = parseGitHubRemote(url);
    if (repo) return repo;
  }
  return undefined;
}

function toRepo(owner: string, name: string): GitHubRepo | undefined {
  const repo = name.replace(/\.git$/, "");
  if (isDotsOnly(owner) || repo === "" || isDotsOnly(repo)) return undefined;
  return { owner, repo };
}

function isDotsOnly(name: string): boolean {
  return /^\.+$/.test(name);
}
