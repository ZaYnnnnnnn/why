import { styleText } from "node:util";
import type {
  ChangeEvidence,
  EvidenceSource,
  ExplainResult,
  GitHubRepo,
  IssueEvidence,
  LineChange,
  LineHistory,
  LinkedHistory,
} from "@why/core";

type Style = Parameters<typeof styleText>[0];
type Paint = (style: Style, text: string) => string;

export interface FormatOptions {
  color: boolean;
  explanation?: ExplainResult;
}

export function formatHistory(
  history: LineHistory | LinkedHistory,
  options: FormatOptions,
): string {
  const paint: Paint = (style, text) =>
    options.color ? styleText(style, text, { validateStream: false }) : text;

  const location = `${history.path}:${history.line}`;
  const lines = [
    paint("bold", history.rev === "HEAD" ? location : `${location} at ${history.rev}`),
    `  ${history.content}`,
    "",
  ];

  const github = "github" in history ? history.github : undefined;
  if (options.explanation?.status === "explained") {
    lines.push(...formatExplanation(options.explanation, github, paint), "");
  }

  const count = history.changes.length;
  if (count === 0) {
    lines.push(paint("dim", "No commits found for this line."), "");
    return lines.join("\n");
  }
  lines.push(paint("dim", `${count} change${count === 1 ? "" : "s"}, newest first`), "");

  for (const change of history.changes) {
    lines.push(
      `${paint("yellow", change.commit.slice(0, 7))}  ${change.date.slice(0, 10)}  ${change.authorName}`,
      `  ${paint("bold", change.subject)}`,
      paint("dim", `  ${describe(change, history.path)}`),
    );

    const unchangedMove = change.kind === "moved" && change.before.join() === change.after.join();
    if (!unchangedMove) {
      lines.push(
        ...change.before.map((text) => paint("red", `  - ${text}`)),
        ...change.after.map((text) => paint("green", `  + ${text}`)),
      );
    }

    if (change.possibleOrigins) {
      const places = change.possibleOrigins.map((o) => `${o.path}:${o.lineNumber}`).join(" or ");
      lines.push(paint("dim", `  may have been moved from ${places}`));
    }

    if (github && "evidence" in change) {
      lines.push(...formatEvidence(change.evidence as ChangeEvidence, github, paint));
    }
    lines.push("");
  }

  if (github) lines.push(paint("dim", summary(history as LinkedHistory)), "");

  return lines.join("\n");
}

function formatExplanation(
  result: Extract<ExplainResult, { status: "explained" }>,
  github: GitHubRepo | undefined,
  paint: Paint,
): string[] {
  const labels = new Map(result.sources.map((source) => [source.id, citeLabel(source, github)]));
  const cite = (ids: string[]) =>
    paint("dim", `(${ids.map((id) => labels.get(id) ?? id).join(", ")})`);
  const { explanation } = result;

  const lines = [
    paint("bold", "Why"),
    `  ${explanation.summary} ${cite(explanation.summaryCites)}`,
    "",
  ];
  for (const entry of explanation.timeline) lines.push(`  - ${entry.text} ${cite(entry.cites)}`);
  lines.push("", paint("dim", `  Confidence: ${explanation.confidence}`));
  for (const gap of explanation.gaps) lines.push(paint("dim", `  Not in the evidence: ${gap}`));
  const model = result.model === "default" ? "" : ` ${result.model}`;
  lines.push(
    paint("dim", `  Explained by ${result.provider}${model}${result.cached ? " (cached)" : ""}`),
  );
  return lines;
}

function citeLabel(source: EvidenceSource, github: GitHubRepo | undefined): string {
  if (source.kind !== "issue" || !github) return source.label;
  const prefix = `${github.owner}/${github.repo}#`;
  const at = source.label.toLowerCase().indexOf(prefix.toLowerCase());
  if (at === -1) return source.label;
  return `${source.label.slice(0, at)}#${source.label.slice(at + prefix.length)}`;
}

function formatEvidence(evidence: ChangeEvidence, github: GitHubRepo, paint: Paint): string[] {
  const lines: string[] = [];
  const pr = evidence.pullRequest;

  if (pr) {
    const when = pr.mergedAt ? `merged ${pr.mergedAt.slice(0, 10)}` : pr.state;
    const batch = pr.batch ? `, batch of ${pr.commitCount} commits` : "";
    lines.push(
      `  ${paint("cyan", `PR #${pr.number}`)}  ${pr.title}  ${paint("dim", `(${when}, @${pr.author}${batch})`)}`,
    );
    for (const review of pr.reviewComments) {
      lines.push(paint("dim", `    review @${review.author}: ${firstLine(review.body)}`));
    }
  }

  for (const issue of evidence.issues) {
    lines.push(
      `  ${paint("cyan", `${issue.link} ${issueLabel(issue, github)}`)}  ${issue.title}  ${paint("dim", `(${issue.state})`)}`,
    );
  }

  return lines;
}

function issueLabel(issue: IssueEvidence, github: GitHubRepo): string {
  const same =
    issue.owner.toLowerCase() === github.owner.toLowerCase() &&
    issue.repo.toLowerCase() === github.repo.toLowerCase();
  const ref = `${same ? "" : `${issue.owner}/${issue.repo}`}#${issue.number}`;
  return issue.isPullRequest ? `PR ${ref}` : ref;
}

function summary(history: LinkedHistory): string {
  const pulls = new Set<number>();
  const issues = new Set<string>();
  for (const change of history.changes) {
    if (change.evidence.pullRequest) pulls.add(change.evidence.pullRequest.number);
    for (const issue of change.evidence.issues) {
      issues.add(`${issue.owner}/${issue.repo}#${issue.number}`);
    }
  }
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  return `Sources: ${plural(history.changes.length, "commit")}, ${plural(pulls.size, "pull request")}, ${plural(issues.size, "issue")}`;
}

function firstLine(text: string): string {
  const line =
    text
      .split("\n")
      .find((l) => l.trim() !== "")
      ?.trim() ?? "";
  return line.length > 100 ? `${line.slice(0, 99).trimEnd()}…` : line;
}

function describe(change: LineChange, currentPath: string): string {
  const where = `line ${change.lineNumber}${change.path && change.path !== currentPath ? ` in ${change.path}` : ""}`;
  if (change.kind === "moved" && change.movedFrom) {
    return `moved to ${where} from ${change.movedFrom.path}:${change.movedFrom.lineNumber}`;
  }
  return `${change.kind === "added" ? "added" : "changed"} at ${where}`;
}
