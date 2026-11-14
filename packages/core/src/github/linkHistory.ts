import { isWhyError } from "../errors.ts";
import type { LineChange, LineHistory } from "../traceLine.ts";
import { FOREVER, ONE_WEEK, type GitHubClient } from "./client.ts";
import { findIssueRefs, type IssueLink, type IssueRef } from "./refs.ts";
import type { GitHubRepo } from "./remote.ts";

export interface CommentEvidence {
  author: string;
  body: string;
  url: string;
  createdAt: string;
}

export interface PullRequestEvidence {
  number: number;
  title: string;
  url: string;
  author: string;
  state: "merged" | "closed" | "open";
  mergedAt?: string;
  commitCount?: number;
  batch: boolean;
  body: string;
  reviewComments: CommentEvidence[];
}

export interface IssueEvidence {
  owner: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  author: string;
  state: "open" | "closed";
  isPullRequest: boolean;
  link: IssueLink;
  body: string;
  comments: CommentEvidence[];
  commentCount: number;
}

export interface ChangeEvidence {
  pullRequest?: PullRequestEvidence;
  issues: IssueEvidence[];
}

export type LinkedChange = LineChange & { evidence: ChangeEvidence };

export interface LinkedHistory extends Omit<LineHistory, "changes"> {
  github: GitHubRepo;
  changes: LinkedChange[];
  warnings: string[];
}

export interface LinkOptions {
  repo: GitHubRepo;
  client: GitHubClient;
}

export const LIMITS = {
  bodyChars: 4000,
  commentChars: 1000,
  commentsPerItem: 5,
  issuesPerChange: 5,
  batchCommits: 20,
};

interface ApiUser {
  login: string;
}

interface ApiPull {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  user: ApiUser | null;
  state: "open" | "closed";
  merged_at: string | null;
  commits?: number;
}

interface ApiComment {
  body: string | null;
  html_url: string;
  user: ApiUser | null;
  created_at: string;
}

interface ApiReviewComment extends ApiComment {
  path: string;
}

interface ApiIssue {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  user: ApiUser | null;
  state: "open" | "closed";
  comments: number;
  pull_request?: unknown;
}

type IssueDetails = Omit<IssueEvidence, "link">;

export async function linkHistory(
  history: LineHistory,
  { repo, client }: LinkOptions,
): Promise<LinkedHistory> {
  const base = `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`;
  const pulls = new Map<number, Promise<ApiPull | undefined>>();
  const reviews = new Map<number, Promise<ApiReviewComment[]>>();
  const issues = new Map<string, Promise<IssueDetails | undefined>>();
  const warnings: string[] = [];
  const changes: LinkedChange[] = [];

  const once = <K, V>(map: Map<K, Promise<V>>, key: K, load: () => Promise<V>): Promise<V> => {
    let pending = map.get(key);
    if (!pending) {
      pending = load();
      map.set(key, pending);
    }
    return pending;
  };

  const getPull = (number: number) =>
    once(pulls, number, () => orUndefined(client.get<ApiPull>(`${base}/pulls/${number}`, week)));

  const getReviews = (number: number) =>
    once(
      reviews,
      number,
      async () =>
        (await orUndefined(
          client.get<ApiReviewComment[]>(`${base}/pulls/${number}/comments?per_page=100`, week),
        )) ?? [],
    );

  const getIssue = (ref: IssueRef) =>
    once(issues, `${ref.owner}/${ref.repo}#${ref.number}`, async () => {
      const path = `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/issues/${ref.number}`;
      const issue = await orUndefined(client.get<ApiIssue>(path, week));
      if (!issue) return undefined;
      const comments =
        issue.comments > 0
          ? ((await orUndefined(
              client.get<ApiComment[]>(`${path}/comments?per_page=${LIMITS.commentsPerItem}`, week),
            )) ?? [])
          : [];
      return {
        owner: ref.owner,
        repo: ref.repo,
        number: issue.number,
        title: issue.title,
        url: issue.html_url,
        author: login(issue.user),
        state: issue.state,
        isPullRequest: issue.pull_request !== undefined,
        body: truncate(issue.body, LIMITS.bodyChars),
        comments: comments.slice(0, LIMITS.commentsPerItem).map(toComment),
        commentCount: issue.comments,
      };
    });

  async function findPullNumber(change: LineChange): Promise<number | undefined> {
    const associated =
      (await orUndefined(
        client.get<ApiPull[]>(`${base}/commits/${change.commit}/pulls`, {
          maxAgeMs: (cached) => (Array.isArray(cached) && cached.length > 0 ? FOREVER : ONE_WEEK),
        }),
      )) ?? [];
    const chosen = associated.find((pull) => pull.merged_at) ?? associated[0];
    if (chosen) return chosen.number;

    const squashed = /\(#(\d+)\)\s*$/.exec(change.subject);
    return squashed ? Number(squashed[1]) : undefined;
  }

  async function evidenceFor(change: LineChange): Promise<ChangeEvidence> {
    const number = await findPullNumber(change);
    const pull = number === undefined ? undefined : await getPull(number);
    const pullRequest = pull && (await toPullRequest(pull, change.path));

    const fromPull = pull && !pullRequest?.batch ? [pull.title, pull.body ?? ""] : [];
    const text = [change.subject, change.body, ...fromPull].join("\n");
    const refs = findIssueRefs(text, repo)
      .filter((ref) => !(pull && sameRepo(ref, repo) && ref.number === pull.number))
      .slice(0, LIMITS.issuesPerChange);

    const linked: IssueEvidence[] = [];
    for (const ref of refs) {
      const issue = await getIssue(ref);
      if (issue) linked.push({ ...issue, link: ref.link });
    }

    return { ...(pullRequest ? { pullRequest } : {}), issues: linked };
  }

  async function toPullRequest(pull: ApiPull, path: string): Promise<PullRequestEvidence> {
    const onThisFile = (await getReviews(pull.number))
      .filter((comment) => comment.path === path)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .slice(0, LIMITS.commentsPerItem);

    return {
      number: pull.number,
      title: pull.title,
      url: pull.html_url,
      author: login(pull.user),
      state: pull.merged_at ? "merged" : pull.state,
      ...(pull.merged_at ? { mergedAt: pull.merged_at } : {}),
      ...(pull.commits !== undefined ? { commitCount: pull.commits } : {}),
      batch: (pull.commits ?? 0) > LIMITS.batchCommits,
      body: truncate(pull.body, LIMITS.bodyChars),
      reviewComments: onThisFile.map(toComment),
    };
  }

  for (const change of history.changes) {
    if (warnings.length > 0) {
      changes.push({ ...change, evidence: { issues: [] } });
      continue;
    }
    try {
      changes.push({ ...change, evidence: await evidenceFor(change) });
    } catch (error) {
      if (!isWhyError(error, "GITHUB_RATE_LIMITED") && !isWhyError(error, "GITHUB_FAILED")) {
        throw error;
      }
      warnings.push(error.message);
      changes.push({ ...change, evidence: { issues: [] } });
    }
  }

  return { ...history, github: repo, changes, warnings };
}

const week = { maxAgeMs: ONE_WEEK };

async function orUndefined<T>(request: Promise<T>): Promise<T | undefined> {
  try {
    return await request;
  } catch (error) {
    if (isWhyError(error, "GITHUB_NOT_FOUND")) return undefined;
    throw error;
  }
}

function toComment(comment: ApiComment): CommentEvidence {
  return {
    author: login(comment.user),
    body: truncate(comment.body, LIMITS.commentChars),
    url: comment.html_url,
    createdAt: comment.created_at,
  };
}

function login(user: ApiUser | null): string {
  return user?.login ?? "ghost";
}

function sameRepo(a: GitHubRepo, b: GitHubRepo): boolean {
  return (
    a.owner.toLowerCase() === b.owner.toLowerCase() && a.repo.toLowerCase() === b.repo.toLowerCase()
  );
}

export function truncate(text: string | null, max: number): string {
  const clean = (text ?? "").replace(/\r\n/g, "\n").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}
