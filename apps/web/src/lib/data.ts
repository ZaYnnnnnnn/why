import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DemoFile, DemoRepoIndex } from "./types.ts";

const DATA_DIR = join(process.cwd(), "public", "data");

export interface DemoProject {
  repo: string;
  title: string;
  description: string;
  files: string[];
}

export function loadProjects(): DemoProject[] {
  return JSON.parse(readFileSync(join(process.cwd(), "demo.json"), "utf8")) as DemoProject[];
}

export function loadIndex(repo: string): DemoRepoIndex | undefined {
  const file = join(DATA_DIR, repo, "index.json");
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as DemoRepoIndex) : undefined;
}

export function loadIndexes(): DemoRepoIndex[] {
  return loadProjects().flatMap((project) => loadIndex(project.repo) ?? []);
}

export function loadFile(repo: string, path: string): DemoFile | undefined {
  const file = join(DATA_DIR, repo, "files", `${path}.json`);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as DemoFile) : undefined;
}
