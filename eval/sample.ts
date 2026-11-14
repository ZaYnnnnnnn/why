import { readFileSync, writeFileSync } from "node:fs";
import { ensureRepo, git, loadRepos } from "./repos.ts";

const SEED = 20261114;
const PER_REPO = 10;
const MIN_LENGTH = 20;
const TEST_PATH = /(^|\/)(__tests__|tests?|spec|fixtures?|__mocks__)(\/|$)|\.(test|spec)\./;
const COMMENT = /^(\/\/|\/\*|\*|#|"""|''')/;

export interface EvalCase {
  id: string;
  repo: string;
  commit: string;
  path: string;
  line: number;
  text: string;
}

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function isCandidate(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length >= MIN_LENGTH && !COMMENT.test(trimmed);
}

function sample(): EvalCase[] {
  const cases: EvalCase[] = [];
  for (const repo of loadRepos()) {
    const path = ensureRepo(repo);
    const random = mulberry32(SEED + [...repo.name].reduce((sum, c) => sum + c.charCodeAt(0), 0));
    const files = git(path, ["ls-tree", "-r", "--name-only", repo.commit, "--", ...repo.sourceDirs])
      .split("\n")
      .filter(
        (file) =>
          file && repo.extensions.some((ext) => file.endsWith(ext)) && !TEST_PATH.test(file),
      )
      .sort();

    const pool: Array<{ path: string; line: number; text: string }> = [];
    for (const file of files) {
      git(path, ["show", `${repo.commit}:${file}`])
        .split("\n")
        .forEach((text, index) => {
          if (isCandidate(text)) pool.push({ path: file, line: index + 1, text });
        });
    }

    const chosen = new Set<number>();
    while (chosen.size < Math.min(PER_REPO, pool.length)) {
      chosen.add(Math.floor(random() * pool.length));
    }
    [...chosen]
      .sort((a, b) => a - b)
      .forEach((index, n) => {
        const pick = pool[index]!;
        cases.push({
          id: `${repo.name}-${String(n + 1).padStart(2, "0")}`,
          repo: repo.name,
          commit: repo.commit,
          ...pick,
        });
      });
    console.error(
      `${repo.name}: ${files.length} files, ${pool.length} candidate lines, ${chosen.size} picked`,
    );
  }
  return cases;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = new URL("./cases.json", import.meta.url);
  const previous = (() => {
    try {
      return JSON.parse(readFileSync(out, "utf8")) as Array<Record<string, unknown>>;
    } catch {
      return [];
    }
  })();
  const labels = new Map(previous.map((c) => [c["id"], c]));
  const merged = sample().map((c) => {
    const old = labels.get(c.id);
    return old && old["path"] === c.path && old["line"] === c.line ? { ...old, ...c } : c;
  });
  writeFileSync(out, `${JSON.stringify(merged, null, 2)}\n`);
  console.error(`Wrote ${merged.length} cases to eval/cases.json`);
}
