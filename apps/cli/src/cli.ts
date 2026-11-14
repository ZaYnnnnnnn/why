import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  createGitHubClient,
  defaultCacheDir,
  fileCache,
  findGitHubRepo,
  isWhyError,
  linkHistory,
  parseRepoSlug,
  traceLine,
  type GitHubRepo,
  type LineHistory,
  type LinkedHistory,
} from "@why/core";
import { formatHistory } from "./format.ts";

export interface Output {
  write: (text: string) => unknown;
  isTTY?: boolean;
}

export interface Io {
  stdout: Output;
  stderr: Output;
  cwd: string;
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
}

export const EXIT_OK = 0;
export const EXIT_FAILURE = 1;
export const EXIT_USAGE = 2;

export const USAGE = `Usage: why <file>:<line> [options]

Show every commit that changed a line of code, newest first, with the
pull requests and issues behind each change when the repo is on GitHub.

Options:
  --json                 Print machine-readable JSON
  --rev <rev>            Start from this commit, branch or tag (default: HEAD)
  --repo <path>          Run inside this folder instead of the current one
  --github <owner/repo>  Use this GitHub repository instead of the git remotes
  --no-github            Skip GitHub and show git history only
  --refresh              Ignore cached GitHub answers
  -h, --help             Show this help

Set GITHUB_TOKEN (or GH_TOKEN) to raise GitHub's limit from 60 to 5,000
requests per hour. The token is only sent to api.github.com.
`;

export async function run(argv: string[], io: Io): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        json: { type: "boolean" },
        rev: { type: "string" },
        repo: { type: "string" },
        github: { type: "string" },
        "no-github": { type: "boolean" },
        refresh: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (error) {
    io.stderr.write(`why: ${(error as Error).message}\n\n${USAGE}`);
    return EXIT_USAGE;
  }

  const { values, positionals } = parsed;
  if (values.help) {
    io.stdout.write(USAGE);
    return EXIT_OK;
  }
  if (positionals.length !== 1) {
    io.stderr.write(`why: expected exactly one <file>:<line>\n\n${USAGE}`);
    return EXIT_USAGE;
  }

  const target = parseTarget(positionals[0] ?? "");
  if (!target) {
    io.stderr.write(`why: expected <file>:<line>, for example src/app.ts:42\n`);
    return EXIT_USAGE;
  }

  try {
    const chosenRepo = values.github ? parseRepoSlug(values.github) : undefined;
    const history = await traceLine({
      cwd: values.repo ? resolve(io.cwd, values.repo) : io.cwd,
      file: target.file,
      line: target.line,
      ...(values.rev ? { rev: values.rev } : {}),
    });

    const result = values["no-github"]
      ? history
      : await withGitHub(history, chosenRepo ?? (await findGitHubRepo(history.root)), {
          io,
          refresh: values.refresh === true,
        });

    io.stdout.write(
      values.json
        ? `${JSON.stringify(result, null, 2)}\n`
        : formatHistory(result, { color: useColor(io) }),
    );
    return EXIT_OK;
  } catch (error) {
    if (!isWhyError(error)) throw error;
    io.stderr.write(`why: ${error.message}\n`);
    return error.code === "INVALID_ARGUMENT" ? EXIT_USAGE : EXIT_FAILURE;
  }
}

async function withGitHub(
  history: LineHistory,
  repo: GitHubRepo | undefined,
  { io, refresh }: { io: Io; refresh: boolean },
): Promise<LineHistory | LinkedHistory> {
  if (!repo) return history;

  const client = createGitHubClient({
    token: io.env["GITHUB_TOKEN"] || io.env["GH_TOKEN"] || undefined,
    cache: fileCache(defaultCacheDir(io.env)),
    refresh,
    ...(io.fetch ? { fetch: io.fetch } : {}),
  });
  const linked = await linkHistory(history, { repo, client });
  for (const warning of linked.warnings) io.stderr.write(`why: warning: ${warning}\n`);
  return linked;
}

export function parseTarget(value: string): { file: string; line: number } | undefined {
  const separator = value.lastIndexOf(":");
  if (separator <= 0) return undefined;
  const file = value.slice(0, separator);
  const line = value.slice(separator + 1);
  if (!/^\d+$/.test(line)) return undefined;
  return { file, line: Number(line) };
}

function useColor(io: Io): boolean {
  if (io.env["NO_COLOR"]) return false;
  if (io.env["TERM"] === "dumb") return false;
  return io.stdout.isTTY === true;
}
