import type { IssueEvidence, LinkedHistory, PullRequestEvidence } from "../github/linkHistory.ts";
import type { LineChange, LineHistory } from "../traceLine.ts";

export type SourceKind = "commit" | "pull_request" | "issue" | "review_comment";

export interface EvidenceSource {
  id: string;
  kind: SourceKind;
  label: string;
  url?: string;
}

export interface EvidencePack {
  text: string;
  sources: EvidenceSource[];
  level: number;
}

export interface PackOptions {
  maxChars?: number;
}

export const DEFAULT_PACK_CHARS = 48_000;

interface Level {
  issueComments: boolean;
  reviewComments: boolean;
  bodyChars: number;
  messageChars: number;
}

const LEVELS: Level[] = [
  { issueComments: true, reviewComments: true, bodyChars: 4000, messageChars: 4000 },
  { issueComments: false, reviewComments: true, bodyChars: 4000, messageChars: 4000 },
  { issueComments: false, reviewComments: false, bodyChars: 4000, messageChars: 4000 },
  { issueComments: false, reviewComments: false, bodyChars: 1000, messageChars: 1000 },
  { issueComments: false, reviewComments: false, bodyChars: 300, messageChars: 300 },
];

export function buildEvidencePack(
  history: LineHistory | LinkedHistory,
  options: PackOptions = {},
): EvidencePack {
  const maxChars = options.maxChars ?? DEFAULT_PACK_CHARS;
  let pack = render(history, LEVELS[0]!, 0);
  for (let level = 1; pack.text.length > maxChars && level < LEVELS.length; level += 1) {
    pack = render(history, LEVELS[level]!, level);
  }
  return pack;
}

function render(history: LineHistory | LinkedHistory, level: Level, index: number): EvidencePack {
  const ids = assignIds(history);
  const sources: EvidenceSource[] = [];
  const blocks: string[] = [
    [
      `LINE: ${history.path}:${history.line}`,
      `CURRENT TEXT: ${history.content}`,
      `STEPS: ${history.changes.length}, newest first`,
    ].join("\n"),
  ];

  history.changes.forEach((change, i) => {
    const id = `C${i + 1}`;
    const evidence =
      "evidence" in change ? (change as LinkedHistory["changes"][number]).evidence : undefined;
    const pr = evidence?.pullRequest;
    sources.push({ id, kind: "commit", label: change.commit.slice(0, 7) });

    const lines = [
      `[${id}] commit ${change.commit.slice(0, 12)} on ${change.date.slice(0, 10)} by ${change.authorName}`,
      `step: ${describe(change)}`,
      `subject: ${change.subject}`,
    ];
    if (change.body) lines.push(`message:\n${indent(cap(change.body, level.messageChars))}`);
    for (const text of change.before) lines.push(`before: ${text}`);
    for (const text of change.after) lines.push(`after: ${text}`);
    if (change.possibleOrigins) {
      lines.push(
        `may have been moved from: ${change.possibleOrigins.map((o) => `${o.path}:${o.lineNumber}`).join(", ")}`,
      );
    }
    if (pr) lines.push(`part of: ${ids.pulls.get(pr.number)}`);
    for (const issue of evidence?.issues ?? []) {
      lines.push(
        `${issue.link === "closes" ? "closes" : "mentions"}: ${ids.issues.get(issueKey(issue))}`,
      );
    }
    blocks.push(lines.join("\n"));
  });

  for (const [number, prId] of ids.pulls) {
    const pr = ids.pullData.get(number)!;
    sources.push({ id: prId, kind: "pull_request", label: `PR #${pr.number}`, url: pr.url });
    const lines = [
      `[${prId}] pull request #${pr.number} "${pr.title}" by ${pr.author}, ${pr.mergedAt ? `merged ${pr.mergedAt.slice(0, 10)}` : pr.state}${pr.batch ? `, a batch of ${pr.commitCount} commits (its description covers many unrelated changes)` : ""}`,
    ];
    if (pr.body) lines.push(`description:\n${indent(cap(pr.body, level.bodyChars))}`);
    blocks.push(lines.join("\n"));

    if (!level.reviewComments) continue;
    for (const review of ids.reviews.get(number) ?? []) {
      sources.push({
        id: review.id,
        kind: "review_comment",
        label: `review by @${review.comment.author} on PR #${pr.number}`,
        url: review.comment.url,
      });
      blocks.push(
        `[${review.id}] review comment on this file by ${review.comment.author} in ${prId}:\n${indent(cap(review.comment.body, level.bodyChars))}`,
      );
    }
  }

  for (const [key, issueId] of ids.issues) {
    const issue = ids.issueData.get(key)!;
    const label = `${issue.isPullRequest ? "PR " : ""}${issue.owner}/${issue.repo}#${issue.number}`;
    sources.push({ id: issueId, kind: "issue", label, url: issue.url });
    const lines = [
      `[${issueId}] ${issue.isPullRequest ? "pull request" : "issue"} ${issue.owner}/${issue.repo}#${issue.number} "${issue.title}" by ${issue.author} (${issue.state})`,
    ];
    if (issue.body) lines.push(`description:\n${indent(cap(issue.body, level.bodyChars))}`);
    if (level.issueComments) {
      for (const comment of issue.comments) {
        lines.push(`comment by ${comment.author}:\n${indent(cap(comment.body, level.bodyChars))}`);
      }
    }
    blocks.push(lines.join("\n"));
  }

  return { text: neutralise(blocks.join("\n\n")), sources, level: index };
}

interface Ids {
  pulls: Map<number, string>;
  pullData: Map<number, PullRequestEvidence>;
  reviews: Map<
    number,
    Array<{ id: string; comment: PullRequestEvidence["reviewComments"][number] }>
  >;
  issues: Map<string, string>;
  issueData: Map<string, IssueEvidence>;
}

function assignIds(history: LineHistory | LinkedHistory): Ids {
  const ids: Ids = {
    pulls: new Map(),
    pullData: new Map(),
    reviews: new Map(),
    issues: new Map(),
    issueData: new Map(),
  };
  let reviewCount = 0;

  for (const change of history.changes) {
    if (!("evidence" in change)) continue;
    const { evidence } = change as LinkedHistory["changes"][number];
    const pr = evidence.pullRequest;
    if (pr && !ids.pulls.has(pr.number)) {
      ids.pulls.set(pr.number, `PR${ids.pulls.size + 1}`);
      ids.pullData.set(pr.number, pr);
      ids.reviews.set(
        pr.number,
        pr.reviewComments.map((comment) => ({ id: `R${(reviewCount += 1)}`, comment })),
      );
    }
    for (const issue of evidence.issues) {
      const key = issueKey(issue);
      if (!ids.issues.has(key)) {
        ids.issues.set(key, `I${ids.issues.size + 1}`);
        ids.issueData.set(key, issue);
      }
    }
  }
  return ids;
}

function issueKey(issue: IssueEvidence): string {
  return `${issue.owner}/${issue.repo}#${issue.number}`.toLowerCase();
}

function describe(change: LineChange): string {
  const where = `line ${change.lineNumber} in ${change.path}`;
  if (change.kind === "moved" && change.movedFrom) {
    return `moved to ${where} from ${change.movedFrom.path}:${change.movedFrom.lineNumber}`;
  }
  return `${change.kind === "added" ? "added at" : "changed at"} ${where}`;
}

function cap(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

function neutralise(text: string): string {
  return text.replace(/<\/?\s*evidence/gi, (match) => match.replace("<", "‹"));
}
