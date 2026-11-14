import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createClaudeCliProvider,
  WhyError,
  runCommand,
  type RunCommand,
  type RunOptions,
} from "../../src/index.ts";

const request = {
  system: "You explain code.",
  prompt: "<evidence>...</evidence>",
  schema: { type: "object", properties: { summary: { type: "string" } } },
};

function fakeRun(stdout: unknown, extra: { stderr?: string; code?: number } = {}) {
  const calls: Array<{
    command: string;
    args: string[];
    options: RunOptions;
    cwdExisted: boolean;
  }> = [];
  const run: RunCommand = async (command, args, options) => {
    calls.push({ command, args, options, cwdExisted: existsSync(options.cwd) });
    return {
      stdout: typeof stdout === "string" ? stdout : JSON.stringify(stdout),
      stderr: extra.stderr ?? "",
      code: extra.code ?? 0,
    };
  };
  return { run, calls };
}

describe("claude -p provider", () => {
  it("runs claude headless with tools off, no session, the schema and the prompt on stdin", async () => {
    const { run, calls } = fakeRun({ is_error: false, structured_output: { summary: "ok" } });
    const provider = createClaudeCliProvider({ run, env: { PATH: "/usr/bin" } });

    expect(await provider.complete(request)).toEqual({ summary: "ok" });
    expect(provider.name).toBe("claude-cli");
    expect(provider.model).toBe("default");

    const call = calls[0]!;
    expect(call.command).toBe("claude");
    expect(call.args).toEqual([
      "-p",
      "--output-format",
      "json",
      "--tools",
      "",
      "--no-session-persistence",
      "--system-prompt",
      "You explain code.",
      "--json-schema",
      JSON.stringify(request.schema),
    ]);
    expect(call.options.input).toBe("<evidence>...</evidence>");
  });

  it("runs in a fresh empty folder that is removed afterwards", async () => {
    const { run, calls } = fakeRun({ structured_output: {} });
    await createClaudeCliProvider({ run }).complete(request);

    expect(calls[0]!.options.cwd).not.toBe(process.cwd());
    expect(calls[0]!.cwdExisted).toBe(true);
    expect(existsSync(calls[0]!.options.cwd)).toBe(false);
  });

  it("removes API key variables so claude uses its own sign-in, not a billed key", async () => {
    const { run, calls } = fakeRun({ structured_output: {} });
    await createClaudeCliProvider({
      run,
      env: { PATH: "/bin", ANTHROPIC_API_KEY: "sk-ant-x", ANTHROPIC_AUTH_TOKEN: "t", HOME: "/h" },
    }).complete(request);

    expect(calls[0]!.options.env).toEqual({ PATH: "/bin", HOME: "/h" });
  });

  it("passes a chosen model", async () => {
    const { run, calls } = fakeRun({ structured_output: {} });
    const provider = createClaudeCliProvider({ run, model: "sonnet" });
    await provider.complete(request);

    expect(calls[0]!.args.slice(-2)).toEqual(["--model", "sonnet"]);
    expect(provider.model).toBe("sonnet");
  });

  it("reads JSON from the result text when there is no structured output", async () => {
    const { run } = fakeRun({ is_error: false, result: '{"summary":"from text"}' });
    expect(await createClaudeCliProvider({ run }).complete(request)).toEqual({
      summary: "from text",
    });
  });

  it("explains how to sign in when claude is logged out", async () => {
    const { run } = fakeRun({ is_error: true, result: "Not logged in · Please run /login" });
    await expect(createClaudeCliProvider({ run }).complete(request)).rejects.toMatchObject({
      code: "AI_UNAVAILABLE",
      message: "The claude command is not signed in. Run `claude`, then /login, and try again",
    });
  });

  it("reports other claude errors", async () => {
    const { run } = fakeRun({ is_error: true, result: "Usage limit reached" });
    await expect(createClaudeCliProvider({ run }).complete(request)).rejects.toMatchObject({
      code: "AI_FAILED",
      message: "claude -p failed: Usage limit reached",
    });
  });

  it("reports output that is not JSON", async () => {
    const { run } = fakeRun("Segmentation fault", { stderr: "boom\nmore", code: 1 });
    await expect(createClaudeCliProvider({ run }).complete(request)).rejects.toMatchObject({
      code: "AI_FAILED",
      message: "claude -p failed: boom",
    });

    const { run: textRun } = fakeRun({ is_error: false, result: "Here is your answer!" });
    await expect(createClaudeCliProvider({ run: textRun }).complete(request)).rejects.toThrow(
      "claude -p did not return JSON",
    );
  });

  it("finds claude in ~/.local/bin when it is not on PATH", async () => {
    const tried: string[] = [];
    const run: RunCommand = async (command, _args, options) => {
      tried.push(command);
      if (command === "claude") {
        const missing = Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" });
        throw new WhyError("AI_UNAVAILABLE", "claude was not found", { cause: missing });
      }
      expect(options.input).toBe(request.prompt);
      return { stdout: JSON.stringify({ structured_output: { ok: true } }), stderr: "", code: 0 };
    };
    const provider = createClaudeCliProvider({ run, fallbackCommands: [process.execPath] });

    expect(await provider.complete(request)).toEqual({ ok: true });
    expect(tried).toEqual(["claude", process.execPath]);
  });

  it("does not look elsewhere when a command was chosen", async () => {
    const provider = createClaudeCliProvider({
      command: "why-test-no-such-command-xyz",
      fallbackCommands: [process.execPath],
    });
    await expect(provider.complete(request)).rejects.toMatchObject({ code: "AI_UNAVAILABLE" });
  });

  it("explains a missing claude command", async () => {
    const provider = createClaudeCliProvider({
      command: "why-test-no-such-command-xyz",
      fallbackCommands: [],
    });
    await expect(provider.complete(request)).rejects.toMatchObject({ code: "AI_UNAVAILABLE" });
  });
});

describe("runCommand", () => {
  const base = { cwd: process.cwd(), env: process.env, timeoutMs: 10_000 };

  it("sends input on stdin and collects output", async () => {
    const result = await runCommand(
      process.execPath,
      ["-e", "process.stdin.pipe(process.stdout); process.stderr.write('note')"],
      { ...base, input: "hello" },
    );
    expect(result).toEqual({ stdout: "hello", stderr: "note", code: 0 });
  });

  it("stops a command that runs too long", async () => {
    await expect(
      runCommand(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], {
        ...base,
        input: "",
        timeoutMs: 200,
      }),
    ).rejects.toMatchObject({
      code: "AI_FAILED",
      message: expect.stringMatching(/longer than 0.2s/),
    });
  });
});
