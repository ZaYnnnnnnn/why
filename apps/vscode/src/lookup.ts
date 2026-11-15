import { basename, dirname } from "node:path";
import {
  createGitHubClient,
  defaultCacheDir,
  fileCache,
  findGitHubRepo,
  findRepoRoot,
  isWhyError,
  linkHistory,
  mapToCommittedLine,
  toRepoPath,
  traceLine,
  type LineHistory,
  type LinkedHistory,
} from "@why/core";

export type Lookup =
  | {
      status: "found";
      history: LineHistory | LinkedHistory;
      editorLine: number;
      warnings: string[];
    }
  | { status: "uncommitted"; editorLine: number; reason: "added" | "modified" }
  | { status: "untracked"; editorLine: number }
  | { status: "failed"; editorLine: number; message: string };

export interface LookupOptions {
  filePath: string;
  line: number;
  text: string;
  token?: string | undefined;
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
}

export async function lookUpLine(options: LookupOptions): Promise<Lookup> {
  const { filePath, line, text, token, env = process.env } = options;
  try {
    const folder = dirname(filePath);
    const root = await findRepoRoot(folder);
    const path = toRepoPath(root, basename(filePath), folder);
    const mapped = await mapToCommittedLine({ root, path, line, text });
    if (mapped.status === "untracked") return { status: "untracked", editorLine: line };
    if (mapped.status === "uncommitted") {
      return { status: "uncommitted", editorLine: line, reason: mapped.reason };
    }

    const history = await traceLine({ cwd: root, file: path, line: mapped.line });
    const repo = await findGitHubRepo(root);
    if (!repo) return { status: "found", history, editorLine: line, warnings: [] };

    const client = createGitHubClient({
      token,
      cache: fileCache(defaultCacheDir(env)),
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
    const linked = await linkHistory(history, { repo, client });
    return { status: "found", history: linked, editorLine: line, warnings: linked.warnings };
  } catch (error) {
    if (!isWhyError(error)) throw error;
    return { status: "failed", editorLine: line, message: error.message };
  }
}
