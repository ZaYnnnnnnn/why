import { existsSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { WhyError } from "./errors.ts";
import { runGit } from "./git.ts";

export async function findRepoRoot(path: string): Promise<string> {
  if (!existsSync(path)) {
    throw new WhyError("INVALID_ARGUMENT", `Path not found: ${path}`);
  }
  const dir = statSync(path).isDirectory() ? path : dirname(path);
  const root = await runGit(dir, ["rev-parse", "--show-toplevel"]);
  return realpathSync(root.trim());
}

export function toRepoPath(root: string, file: string, cwd: string): string {
  const absolute = resolve(realpathSync(cwd), file);
  const rel = relative(root, absolute);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new WhyError("INVALID_ARGUMENT", `${file} is outside the repository at ${root}`);
  }
  return rel.split(sep).join("/");
}
