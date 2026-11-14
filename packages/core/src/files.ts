import { runGit } from "./git.ts";

export async function readFileAt(root: string, rev: string, path: string): Promise<string[]> {
  return splitLines(await runGit(root, ["show", `${rev}:${path}`]));
}

export function splitLines(content: string): string[] {
  const lines = content.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

export function parseDiffPath(header: string): string {
  const path = header.slice(4).replace(/\t$/, "");
  if (path === "/dev/null") return "";
  return path.replace(/^[ab]\//, "");
}
