import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { WhyError } from "../errors.ts";
import type { AiProvider, CompletionRequest } from "./provider.ts";

export interface RunOptions {
  input: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export type RunCommand = (
  command: string,
  args: string[],
  options: RunOptions,
) => Promise<RunResult>;

export interface ClaudeCliOptions {
  command?: string;
  fallbackCommands?: string[];
  model?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  run?: RunCommand;
}

interface CliOutput {
  is_error?: boolean;
  result?: string;
  structured_output?: unknown;
}

const API_KEY_VARIABLES = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"];

export function createClaudeCliProvider(options: ClaudeCliOptions = {}): AiProvider {
  const {
    command,
    fallbackCommands = [join(homedir(), ".local", "bin", "claude")],
    model,
    timeoutMs = 180_000,
    env = process.env,
    run = runCommand,
  } = options;

  const childEnv = Object.fromEntries(
    Object.entries(env).filter(([key]) => !API_KEY_VARIABLES.includes(key)),
  );

  async function complete(request: CompletionRequest): Promise<unknown> {
    const args = [
      "-p",
      "--output-format",
      "json",
      "--tools",
      "",
      "--strict-mcp-config",
      "--no-session-persistence",
      "--system-prompt",
      request.system,
      "--json-schema",
      JSON.stringify(request.schema),
      ...(model ? ["--model", model] : []),
    ];

    const cwd = mkdtempSync(join(tmpdir(), "why-claude-"));
    let result: RunResult;
    try {
      result = await runFirstAvailable(
        command ? [command] : ["claude", ...fallbackCommands.filter((path) => existsSync(path))],
        (candidate) =>
          run(candidate, args, { input: request.prompt, cwd, env: childEnv, timeoutMs }),
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }

    let output: CliOutput;
    try {
      output = JSON.parse(result.stdout) as CliOutput;
    } catch {
      const detail =
        (result.stderr || result.stdout).trim().split("\n")[0] || `exit code ${result.code}`;
      throw new WhyError("AI_FAILED", `claude -p failed: ${detail}`);
    }

    if (output.is_error) {
      const message = (output.result ?? "unknown error").trim();
      if (/not logged in|\/login/i.test(message)) {
        throw new WhyError(
          "AI_UNAVAILABLE",
          "The claude command is not signed in. Run `claude`, then /login, and try again",
        );
      }
      throw new WhyError("AI_FAILED", `claude -p failed: ${message}`);
    }

    if (output.structured_output !== undefined) return output.structured_output;
    try {
      return JSON.parse(output.result ?? "");
    } catch {
      throw new WhyError("AI_FAILED", "claude -p did not return JSON");
    }
  }

  return { name: "claude-cli", model: model ?? "default", complete };
}

async function runFirstAvailable(
  commands: string[],
  attempt: (command: string) => Promise<RunResult>,
): Promise<RunResult> {
  let missing: unknown;
  for (const candidate of commands) {
    try {
      return await attempt(candidate);
    } catch (error) {
      const notFound =
        error instanceof WhyError &&
        error.code === "AI_UNAVAILABLE" &&
        (error.cause as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
      if (!notFound) throw error;
      missing = error;
    }
  }
  throw missing;
}

export function runCommand(
  command: string,
  args: string[],
  options: RunOptions,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(() =>
        reject(
          new WhyError("AI_FAILED", `${command} took longer than ${options.timeoutMs / 1000}s`),
        ),
      );
    }, options.timeoutMs);

    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      action();
    };

    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.on("error", (error: NodeJS.ErrnoException) =>
      finish(() =>
        reject(
          error.code === "ENOENT"
            ? new WhyError(
                "AI_UNAVAILABLE",
                `${command} was not found. Install Claude Code, or use --ai anthropic with ANTHROPIC_API_KEY`,
                { cause: error },
              )
            : new WhyError("AI_FAILED", `Could not run ${command}: ${error.message}`, {
                cause: error,
              }),
        ),
      ),
    );
    child.on("close", (code) => finish(() => resolve({ stdout, stderr, code })));

    child.stdin.on("error", () => undefined);
    child.stdin.end(options.input);
  });
}
