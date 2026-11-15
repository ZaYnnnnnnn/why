import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import {
  createGitHubClient,
  defaultCacheDir,
  fileCache,
  findGitHubRepo,
  linkHistory,
  parseGitHubRemote,
  traceLine,
  type GitHubRepo,
} from "@why/core";
import { ensureRepo, git, loadRepos } from "../../../eval/repos.ts";
import {
  DATA_VERSION,
  type DemoFile,
  type DemoRepoIndex,
  type DemoSources,
} from "../src/lib/types.ts";
import { collectAnswer, emptySources, isAnswerable } from "./collect.ts";

interface DemoConfig {
  repo: string;
  title: string;
  description: string;
  files: string[];
}

const OUT = new URL("../public/data/", import.meta.url);
const CONCURRENCY = 4;

export function fileDataPath(repo: string, path: string): string {
  return `${repo}/files/${path}.json`;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { only: { type: "string" }, force: { type: "boolean" } },
  });
  const config = JSON.parse(
    readFileSync(new URL("../demo.json", import.meta.url), "utf8"),
  ) as DemoConfig[];
  const repos = new Map(loadRepos().map((repo) => [repo.name, repo]));
  const token = process.env["GITHUB_TOKEN"] || process.env["GH_TOKEN"] || undefined;
  if (!token) console.error("No GITHUB_TOKEN: GitHub allows 60 requests an hour without one.");
  const client = createGitHubClient({ token, cache: fileCache(defaultCacheDir(process.env)) });

  for (const demo of config.filter((d) => !values.only || d.repo === values.only)) {
    const repo = repos.get(demo.repo);
    if (!repo) throw new Error(`${demo.repo} is not in eval/repos.json`);
    const root = ensureRepo(repo);
    const github: GitHubRepo =
      parseGitHubRemote(repo.url) ??
      (await findGitHubRepo(root)) ??
      (() => {
        throw new Error(`No GitHub repository for ${demo.repo}`);
      })();

    const sourcesFile = new URL(`${demo.repo}/sources.json`, OUT);
    const sources: DemoSources = existsSync(sourcesFile)
      ? (JSON.parse(readFileSync(sourcesFile, "utf8")) as DemoSources)
      : emptySources();
    const summaries: DemoRepoIndex["files"] = [];

    for (const path of demo.files) {
      const target = new URL(fileDataPath(demo.repo, path), OUT);
      const source = git(root, ["show", `${repo.commit}:${path}`]);
      const lines = source.split("\n");
      if (lines.at(-1) === "") lines.pop();

      if (!values.force && existsSync(target)) {
        const existing = JSON.parse(readFileSync(target, "utf8")) as DemoFile;
        if (existing.version === DATA_VERSION && existing.commit === repo.commit) {
          summaries.push({
            path,
            lines: lines.length,
            answered: Object.keys(existing.answers).length,
          });
          console.error(`${demo.repo} ${path}: already generated, skipping`);
          continue;
        }
      }

      const wanted = lines.flatMap((text, i) => (isAnswerable(text) ? [i + 1] : []));
      const answers: DemoFile["answers"] = {};
      const started = Date.now();
      let done = 0;
      const queue = [...wanted];

      await Promise.all(
        Array.from({ length: CONCURRENCY }, async () => {
          for (let line = queue.shift(); line !== undefined; line = queue.shift()) {
            const history = await traceLine({ cwd: root, file: path, line, rev: repo.commit });
            const linked = await linkHistory(history, { repo: github, client });
            if (linked.warnings.length > 0) throw new Error(linked.warnings.join("; "));
            answers[String(line)] = collectAnswer(linked, sources);
            done += 1;
            if (done % 25 === 0 || done === wanted.length) {
              console.error(
                `${demo.repo} ${path}: ${done}/${wanted.length} lines (${Math.round((Date.now() - started) / 1000)}s)`,
              );
            }
          }
        }),
      );

      const ordered = Object.fromEntries(
        Object.entries(answers).sort(([a], [b]) => Number(a) - Number(b)),
      );
      const file: DemoFile = {
        version: DATA_VERSION,
        repo: demo.repo,
        path,
        commit: repo.commit,
        source,
        answers: ordered,
      };
      write(target, file);
      write(sourcesFile, sources);
      summaries.push({ path, lines: lines.length, answered: wanted.length });
    }

    const index: DemoRepoIndex = {
      version: DATA_VERSION,
      repo: demo.repo,
      title: demo.title,
      description: demo.description,
      url: repo.url,
      github,
      commit: repo.commit,
      generatedAt: new Date().toISOString(),
      files: summaries,
    };
    write(new URL(`${demo.repo}/index.json`, OUT), index);
    write(sourcesFile, sources);
  }
}

function write(target: URL, value: unknown): void {
  mkdirSync(dirname(target.pathname), { recursive: true });
  writeFileSync(target, `${JSON.stringify(value)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
