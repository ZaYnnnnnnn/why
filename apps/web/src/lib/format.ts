import type { DemoIssue, DemoRepoIndex, DemoStep } from "./types.ts";

export const BASE_PATH = process.env["NEXT_PUBLIC_BASE_PATH"] ?? "";

export function dataUrl(path: string): string {
  return `${BASE_PATH}/data/${path}`;
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      });
}

export function describeStep(step: DemoStep, currentPath: string): string {
  const where = `line ${step.lineNumber}${step.path && step.path !== currentPath ? ` in ${step.path}` : ""}`;
  if (step.kind === "moved" && step.movedFrom) {
    return `Moved to ${where} from ${step.movedFrom.path}:${step.movedFrom.lineNumber}`;
  }
  return `${step.kind === "added" ? "Added at" : "Changed at"} ${where}`;
}

export function issueLabel(issue: DemoIssue, github: DemoRepoIndex["github"]): string {
  const same =
    issue.owner.toLowerCase() === github.owner.toLowerCase() &&
    issue.repo.toLowerCase() === github.repo.toLowerCase();
  return `${issue.isPullRequest ? "PR " : ""}${same ? "" : `${issue.owner}/${issue.repo}`}#${issue.number}`;
}

export function commitUrl(github: DemoRepoIndex["github"], sha: string): string {
  return `https://github.com/${github.owner}/${github.repo}/commit/${sha}`;
}

export function fileUrl(
  github: DemoRepoIndex["github"],
  commit: string,
  path: string,
  line?: number,
): string {
  return `https://github.com/${github.owner}/${github.repo}/blob/${commit}/${path}${line ? `#L${line}` : ""}`;
}

export function languageFor(path: string): "javascript" | "python" | "typescript" | "text" {
  if (/\.(m|c)?jsx?$/.test(path)) return "javascript";
  if (/\.tsx?$/.test(path)) return "typescript";
  if (path.endsWith(".py")) return "python";
  return "text";
}

export function parseLineHash(hash: string): number | undefined {
  const match = /^#L(\d+)$/.exec(hash);
  return match ? Number(match[1]) : undefined;
}

export function firstLine(text: string, max = 140): string {
  const line =
    text
      .split("\n")
      .find((l) => l.trim() !== "")
      ?.trim() ?? "";
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}
