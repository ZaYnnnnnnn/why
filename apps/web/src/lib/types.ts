export const DATA_VERSION = 1;

export interface DemoRepoIndex {
  version: number;
  repo: string;
  title: string;
  description: string;
  url: string;
  github: { owner: string; repo: string };
  commit: string;
  generatedAt: string;
  files: DemoFileSummary[];
}

export interface DemoFileSummary {
  path: string;
  lines: number;
  answered: number;
}

export interface DemoFile {
  version: number;
  repo: string;
  path: string;
  commit: string;
  source: string;
  answers: Record<string, DemoAnswer>;
}

export interface DemoAnswer {
  steps: DemoStep[];
}

export interface DemoStep {
  commit: string;
  kind: "added" | "modified" | "moved";
  path: string;
  lineNumber: number;
  before: string[];
  after: string[];
  movedFrom?: { path: string; lineNumber: number };
  possibleOrigins?: Array<{ path: string; lineNumber: number }>;
  pullRequest?: number;
  reviews?: DemoComment[];
  issues?: Array<{ key: string; link: "closes" | "mentions" }>;
}

export interface DemoComment {
  author: string;
  body: string;
  url: string;
  createdAt: string;
}

export interface DemoSources {
  version: number;
  commits: Record<string, DemoCommit>;
  pullRequests: Record<string, DemoPullRequest>;
  issues: Record<string, DemoIssue>;
}

export interface DemoCommit {
  sha: string;
  author: string;
  date: string;
  subject: string;
  body: string;
}

export interface DemoPullRequest {
  number: number;
  title: string;
  url: string;
  author: string;
  state: "merged" | "closed" | "open";
  mergedAt?: string;
  batch: boolean;
  commitCount?: number;
  body: string;
}

export interface DemoIssue {
  key: string;
  owner: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  author: string;
  state: "open" | "closed";
  isPullRequest: boolean;
  body: string;
  comments: DemoComment[];
  commentCount: number;
}
