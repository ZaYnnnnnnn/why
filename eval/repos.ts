import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface EvalRepo {
  name: string;
  url: string;
  commit: string;
  sourceDirs: string[];
  extensions: string[];
}

export const EVAL_DIR = process.env["WHY_EVAL_DIR"] || join(homedir(), ".cache", "why", "eval");

export function loadRepos(): EvalRepo[] {
  return JSON.parse(readFileSync(new URL("./repos.json", import.meta.url), "utf8")) as EvalRepo[];
}

export function repoPath(repo: EvalRepo): string {
  return join(EVAL_DIR, repo.name);
}

export function ensureRepo(repo: EvalRepo): string {
  const path = repoPath(repo);
  if (!existsSync(path)) {
    mkdirSync(EVAL_DIR, { recursive: true });
    console.error(`Cloning ${repo.url} into ${path} (full history, this can take a while)`);
    execFileSync("git", ["clone", "--quiet", "--single-branch", repo.url, path], {
      stdio: "inherit",
    });
  }
  execFileSync("git", ["-C", path, "cat-file", "-e", `${repo.commit}^{commit}`]);
  return path;
}

export function git(path: string, args: string[]): string {
  return execFileSync("git", ["-C", path, ...args], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
}
