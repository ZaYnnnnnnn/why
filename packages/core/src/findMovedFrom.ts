import { parseDiffPath, readFileAt } from "./files.ts";
import { runGit } from "./git.ts";

export interface MoveTarget {
  commit: string;
  path: string;
  lineNumber: number;
  text: string;
}

export interface SourceLocation {
  path: string;
  lineNumber: number;
}

export type MoveMatch = "exact" | "similar";

export type MoveResult =
  | { status: "moved"; from: SourceLocation; text: string; match: MoveMatch }
  | { status: "ambiguous"; candidates: SourceLocation[] }
  | { status: "none" };

interface RemovedLine extends SourceLocation {
  text: string;
}

interface Candidate {
  line: RemovedLine;
  match: MoveMatch;
  score: number;
}

const CONTEXT_RADIUS = 3;
const MIN_CONTEXT_FOR_COMMON_LINES = 2;
const MIN_CONTEXT_FOR_SIMILAR_LINES = 1;
const SIMILARITY_THRESHOLD = 0.8;
const MIN_MEANINGFUL_LENGTH = 6;
const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/;
const NONE: MoveResult = { status: "none" };

export async function findMovedFrom(root: string, target: MoveTarget): Promise<MoveResult> {
  const parent = await parentOf(root, target.commit);
  if (!parent) return NONE;

  const diff = await runGit(root, [
    "diff",
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    "--unified=0",
    "-M",
    parent,
    target.commit,
  ]);
  const removed = parseRemovedLines(diff);
  if (removed.length === 0) return NONE;

  const wanted = normalize(target.text);
  const meaningful = isMeaningful(wanted);
  const newLines = await readFileAt(root, target.commit, target.path);
  const oldFiles = new Map<string, string[]>();
  const candidates: Candidate[] = [];

  for (const line of removed) {
    const text = normalize(line.text);
    const match = matchKind(text, wanted, meaningful);
    if (!match) continue;

    let oldLines = oldFiles.get(line.path);
    if (!oldLines) {
      oldLines = await readFileAt(root, parent, line.path);
      oldFiles.set(line.path, oldLines);
    }
    const context = sharedContext(oldLines, line.lineNumber, newLines, target.lineNumber);

    if (!meaningful && context < MIN_CONTEXT_FOR_COMMON_LINES) continue;
    if (match === "similar" && context < MIN_CONTEXT_FOR_SIMILAR_LINES) continue;
    candidates.push({ line, match, score: (match === "exact" ? 10 : 5) + context });
  }

  if (candidates.length === 0) return NONE;

  const best = Math.max(...candidates.map((c) => c.score));
  const top = candidates.filter((c) => c.score === best);
  if (top.length > 1) {
    return { status: "ambiguous", candidates: top.map((c) => location(c.line)) };
  }

  const [winner] = top as [Candidate];
  return {
    status: "moved",
    from: location(winner.line),
    text: winner.line.text,
    match: winner.match,
  };
}

export function parseRemovedLines(diff: string): RemovedLine[] {
  const removed: RemovedLine[] = [];
  let path = "";
  let oldLine = 0;
  let inHunk = false;

  for (const raw of diff.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      inHunk = false;
      path = "";
      continue;
    }

    const header = HUNK_HEADER.exec(raw);
    if (header) {
      inHunk = true;
      oldLine = Number(header[1]);
      continue;
    }

    if (!inHunk) {
      if (raw.startsWith("--- ")) path = parseDiffPath(raw);
      continue;
    }

    if (raw.startsWith("-")) {
      if (path) removed.push({ path, lineNumber: oldLine, text: raw.slice(1) });
      oldLine += 1;
    } else if (raw.startsWith(" ")) {
      oldLine += 1;
    }
  }

  return removed;
}

export function normalize(text: string): string {
  return text.replace(/\s+/g, "");
}

export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const counts = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i += 1) {
    const pair = a.slice(i, i + 2);
    counts.set(pair, (counts.get(pair) ?? 0) + 1);
  }

  let overlap = 0;
  for (let i = 0; i < b.length - 1; i += 1) {
    const pair = b.slice(i, i + 2);
    const count = counts.get(pair) ?? 0;
    if (count > 0) {
      overlap += 1;
      counts.set(pair, count - 1);
    }
  }

  return (2 * overlap) / (a.length - 1 + b.length - 1);
}

function matchKind(text: string, wanted: string, meaningful: boolean): MoveMatch | undefined {
  if (text === wanted) return "exact";
  if (meaningful && isMeaningful(text) && similarity(text, wanted) >= SIMILARITY_THRESHOLD) {
    return "similar";
  }
  return undefined;
}

function isMeaningful(normalized: string): boolean {
  return normalized.length >= MIN_MEANINGFUL_LENGTH && /[A-Za-z0-9]/.test(normalized);
}

function sharedContext(
  oldLines: string[],
  oldLineNumber: number,
  newLines: string[],
  newLineNumber: number,
): number {
  let shared = 0;
  for (let offset = -CONTEXT_RADIUS; offset <= CONTEXT_RADIUS; offset += 1) {
    if (offset === 0) continue;
    const before = oldLines[oldLineNumber - 1 + offset];
    const after = newLines[newLineNumber - 1 + offset];
    if (before === undefined || after === undefined) continue;
    const text = normalize(before);
    if (text !== "" && text === normalize(after)) shared += 1;
  }
  return shared;
}

async function parentOf(root: string, commit: string): Promise<string | undefined> {
  try {
    return (await runGit(root, ["rev-parse", "--verify", "--quiet", `${commit}^1`])).trim();
  } catch {
    return undefined;
  }
}

function location(line: RemovedLine): SourceLocation {
  return { path: line.path, lineNumber: line.lineNumber };
}
