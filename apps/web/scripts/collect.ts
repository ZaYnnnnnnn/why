import type { IssueEvidence, LinkedChange, LinkedHistory } from "@why/core";
import {
  DATA_VERSION,
  type DemoAnswer,
  type DemoSources,
  type DemoStep,
} from "../src/lib/types.ts";

const COMMENT_ONLY = /^(\/\/|\/\*|\*|#|"""|''')/;

export function isAnswerable(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length >= 8 && !COMMENT_ONLY.test(trimmed) && /[A-Za-z0-9]/.test(trimmed);
}

export function emptySources(): DemoSources {
  return { version: DATA_VERSION, commits: {}, pullRequests: {}, issues: {} };
}

export function issueKey(issue: Pick<IssueEvidence, "owner" | "repo" | "number">): string {
  return `${issue.owner}/${issue.repo}#${issue.number}`.toLowerCase();
}

export function collectAnswer(history: LinkedHistory, sources: DemoSources): DemoAnswer {
  return { steps: history.changes.map((change) => collectStep(change, sources)) };
}

function collectStep(change: LinkedChange, sources: DemoSources): DemoStep {
  sources.commits[change.commit] ??= {
    sha: change.commit,
    author: change.authorName,
    date: change.date,
    subject: change.subject,
    body: change.body,
  };

  const step: DemoStep = {
    commit: change.commit,
    kind: change.kind,
    path: change.path,
    lineNumber: change.lineNumber,
    before: change.before,
    after: change.after,
  };
  if (change.movedFrom) step.movedFrom = change.movedFrom;
  if (change.possibleOrigins) step.possibleOrigins = change.possibleOrigins;

  const pr = change.evidence.pullRequest;
  if (pr) {
    step.pullRequest = pr.number;
    sources.pullRequests[String(pr.number)] ??= {
      number: pr.number,
      title: pr.title,
      url: pr.url,
      author: pr.author,
      state: pr.state,
      ...(pr.mergedAt ? { mergedAt: pr.mergedAt } : {}),
      batch: pr.batch,
      ...(pr.commitCount !== undefined ? { commitCount: pr.commitCount } : {}),
      body: pr.body,
    };
    if (pr.reviewComments.length > 0) step.reviews = pr.reviewComments;
  }

  if (change.evidence.issues.length > 0) {
    step.issues = change.evidence.issues.map((issue) => {
      const key = issueKey(issue);
      sources.issues[key] ??= {
        key,
        owner: issue.owner,
        repo: issue.repo,
        number: issue.number,
        title: issue.title,
        url: issue.url,
        author: issue.author,
        state: issue.state,
        isPullRequest: issue.isPullRequest,
        body: issue.body,
        comments: issue.comments,
        commentCount: issue.commentCount,
      };
      return { key, link: issue.link };
    });
  }

  return step;
}
