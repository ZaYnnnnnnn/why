import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export interface Author {
  name: string;
  email: string;
}

export interface CommitSpec {
  message: string;
  files?: Record<string, string | null>;
  renames?: Record<string, string>;
  author?: Author;
  date?: string;
}

export interface TestRepo {
  path: string;
  commits: string[];
  git: (...args: string[]) => string;
  cleanup: () => void;
}

const DEFAULT_AUTHOR: Author = { name: "Test Author", email: "test@example.com" };
const BASE_DATE = Date.UTC(2020, 0, 1);
const DAY_MS = 24 * 60 * 60 * 1000;

export function createRepo(history: CommitSpec[]): TestRepo {
  const path = mkdtempSync(join(tmpdir(), "why-testrepo-"));
  const baseEnv: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_CONFIG_GLOBAL: devNull,
    GIT_CONFIG_NOSYSTEM: "1",
  };

  const run = (args: string[], env: NodeJS.ProcessEnv = baseEnv): string =>
    execFileSync("git", args, { cwd: path, env, encoding: "utf8" }).trim();

  const cleanup = () => rmSync(path, { recursive: true, force: true });

  try {
    run(["init", "-q", "-b", "main"]);

    const commits = history.map((spec, index) => {
      for (const [from, to] of Object.entries(spec.renames ?? {})) {
        const target = insideRepo(path, to);
        mkdirSync(dirname(target), { recursive: true });
        run(["mv", insideRepo(path, from), target]);
      }

      for (const [file, content] of Object.entries(spec.files ?? {})) {
        const target = insideRepo(path, file);
        if (content === null) {
          rmSync(target);
        } else {
          mkdirSync(dirname(target), { recursive: true });
          writeFileSync(target, content);
        }
      }

      const author = spec.author ?? DEFAULT_AUTHOR;
      const date = spec.date ?? new Date(BASE_DATE + index * DAY_MS).toISOString();
      const commitEnv: NodeJS.ProcessEnv = {
        ...baseEnv,
        GIT_AUTHOR_NAME: author.name,
        GIT_AUTHOR_EMAIL: author.email,
        GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_NAME: author.name,
        GIT_COMMITTER_EMAIL: author.email,
        GIT_COMMITTER_DATE: date,
      };

      run(["add", "-A"]);
      run(["commit", "-q", "--no-verify", "-m", spec.message], commitEnv);
      return run(["rev-parse", "HEAD"]);
    });

    return { path, commits, git: (...args) => run(args), cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}

function insideRepo(root: string, file: string): string {
  const target = resolve(root, file);
  const rel = relative(root, target);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Path escapes the test repo: ${file}`);
  }
  return target;
}
