import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { WhyError } from "./errors.ts";

const execFileAsync = promisify(execFile);
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

export async function runGit(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["-c", "core.quotepath=off", ...args], {
      cwd,
      encoding: "utf8",
      maxBuffer: MAX_OUTPUT_BYTES,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
    });
    return stdout;
  } catch (error) {
    throw toWhyError(error, args);
  }
}

function toWhyError(error: unknown, args: string[]): WhyError {
  const failure = error as NodeJS.ErrnoException & { stderr?: string };
  const command = `git ${args[0] ?? ""}`.trim();

  if (failure.code === "ENOENT") {
    return new WhyError("GIT_FAILED", "git is not installed or not on PATH", { cause: error });
  }
  if (failure.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
    return new WhyError("GIT_FAILED", `${command} produced too much output`, { cause: error });
  }

  const stderr = (failure.stderr ?? "").trim();
  if (/not a git repository/i.test(stderr)) {
    return new WhyError("NOT_A_REPO", "Not inside a git repository", { cause: error });
  }

  const detail = stderr.split("\n")[0] || failure.message;
  return new WhyError("GIT_FAILED", `${command} failed: ${detail}`, { cause: error });
}
