import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  DEFAULT_MIN_LINE_SIMILARITY,
  traceLine,
  type TraceOptions,
} from "../packages/core/src/index.ts";
import { ensureRepo, loadRepos } from "./repos.ts";

export interface LabelledCase {
  id: string;
  repo: string;
  commit: string;
  path: string;
  line: number;
  text: string;
  origin: string;
  latest: string;
  tags: string[];
  note: string;
}

export type Outcome = "correct" | "stopped early" | "went too far" | "wrong path";

export interface CaseResult {
  id: string;
  outcome: Outcome;
  latestCorrect: boolean;
  steps: number;
  ms: number;
  ended: string;
  tags: string[];
}

export async function runCase(
  c: LabelledCase,
  root: string,
  extra: Pick<TraceOptions, "minLineSimilarity"> = {},
): Promise<CaseResult> {
  const started = performance.now();
  const history = await traceLine({
    cwd: root,
    file: c.path,
    line: c.line,
    rev: c.commit,
    ...extra,
  });
  const ms = Math.round(performance.now() - started);
  const commits = history.changes.map((change) => change.commit);
  const ended = commits.at(-1) ?? "";

  let outcome: Outcome = "correct";
  if (ended !== c.origin) {
    if (commits.includes(c.origin)) outcome = "went too far";
    else if (isAncestor(root, c.origin, ended)) outcome = "stopped early";
    else outcome = "wrong path";
  }

  return {
    id: c.id,
    outcome,
    latestCorrect: commits[0] === c.latest,
    steps: commits.length,
    ms,
    ended,
    tags: c.tags,
  };
}

function isAncestor(root: string, older: string, newer: string): boolean {
  try {
    execFileSync("git", ["-C", root, "merge-base", "--is-ancestor", older, newer]);
    return true;
  } catch {
    return false;
  }
}

export function summarise(results: CaseResult[]): string {
  const count = (outcome: Outcome) => results.filter((r) => r.outcome === outcome).length;
  const pct = (n: number) => `${Math.round((100 * n) / results.length)}%`;
  const correct = count("correct");
  const latest = results.filter((r) => r.latestCorrect).length;
  const times = results.map((r) => r.ms).sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)] ?? 0;

  const lines = [
    `Origin correct: ${correct}/${results.length} (${pct(correct)})`,
    `Latest change correct: ${latest}/${results.length} (${pct(latest)})`,
    `Misses: ${count("stopped early")} stopped early, ${count("went too far")} went too far, ${count("wrong path")} wrong path`,
    `Time per line: median ${median} ms, slowest ${times.at(-1) ?? 0} ms`,
  ];

  const tags = [...new Set(results.flatMap((r) => r.tags))].sort();
  if (tags.length > 0) {
    lines.push("", "By tag:");
    for (const tag of tags) {
      const tagged = results.filter((r) => r.tags.includes(tag));
      const right = tagged.filter((r) => r.outcome === "correct").length;
      lines.push(`  ${tag}: ${right}/${tagged.length}`);
    }
  }
  return lines.join("\n");
}

export function table(cases: LabelledCase[], results: CaseResult[]): string {
  const rows = results.map((r) => {
    const c = cases.find((x) => x.id === r.id)!;
    const mark = r.outcome === "correct" ? "yes" : r.outcome;
    return `| ${r.id} | \`${c.path}:${c.line}\` | ${mark} | ${r.latestCorrect ? "yes" : "no"} | ${r.steps} | ${r.ms} | ${c.tags.join(", ")} |`;
  });
  return [
    "| Case | Line | Origin | Latest | Steps | ms | Tags |",
    "| ---- | ---- | ------ | ------ | ----- | -- | ---- |",
    ...rows,
  ].join("\n");
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      "min-line-similarity": { type: "string" },
      sweep: { type: "boolean" },
      write: { type: "boolean" },
      only: { type: "string" },
    },
  });
  const cases = JSON.parse(
    readFileSync(new URL("./cases.json", import.meta.url), "utf8"),
  ) as LabelledCase[];
  const roots = new Map(loadRepos().map((repo) => [repo.name, ensureRepo(repo)]));
  const selected = cases.filter((x) => !values.only || x.id === values.only);

  const runAll = async (extra: Pick<TraceOptions, "minLineSimilarity">, quiet: boolean) => {
    const results: CaseResult[] = [];
    for (const c of selected) {
      const result = await runCase(c, roots.get(c.repo)!, extra);
      results.push(result);
      if (!quiet) {
        console.error(
          `${result.id.padEnd(11)} ${result.outcome.padEnd(13)} latest ${result.latestCorrect ? "yes" : "no "}  ${String(result.steps).padStart(3)} steps  ${result.ms} ms`,
        );
      }
    }
    return results;
  };

  if (values.sweep) {
    const baseline = await runAll({}, true);
    console.log(
      `cut-off  origin  stopped-early  too-far  changed vs default (${DEFAULT_MIN_LINE_SIMILARITY})`,
    );
    for (const cutoff of [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.55, 0.6, 0.65, 0.7, 0.8]) {
      const results = await runAll({ minLineSimilarity: cutoff }, true);
      const count = (o: Outcome) => results.filter((r) => r.outcome === o).length;
      const changed = results
        .filter((r, i) => r.outcome !== baseline[i]!.outcome)
        .map((r) => `${r.id}:${baseline.find((b) => b.id === r.id)!.outcome}->${r.outcome}`)
        .join(" ");
      console.log(
        `${String(cutoff).padStart(7)}  ${String(count("correct")).padStart(2)}/${results.length}  ${String(count("stopped early")).padStart(13)}  ${String(count("went too far")).padStart(7)}  ${changed}`,
      );
    }
    return;
  }

  const cutoff = values["min-line-similarity"];
  const extra = cutoff === undefined ? {} : { minLineSimilarity: Number(cutoff) };
  const results = await runAll(extra, false);
  const summary = summarise(results);
  console.log(`\n${summary}`);

  if (values.write) {
    const setting =
      cutoff === undefined ? "default settings" : `minLineSimilarity ${extra.minLineSimilarity}`;
    writeFileSync(
      new URL("./results.md", import.meta.url),
      `# Accuracy results\n\n${cases.length} lines, ${setting}. Generated by \`pnpm eval --write\`.\n\n\`\`\`text\n${summary}\n\`\`\`\n\n${table(cases, results)}\n`,
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
