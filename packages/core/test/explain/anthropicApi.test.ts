import { describe, expect, it } from "vitest";
import { createAnthropicProvider, DEFAULT_ANTHROPIC_MODEL } from "../../src/index.ts";

const request = {
  system: "You explain code.",
  prompt: "<evidence>x</evidence>",
  schema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] },
};

function message(content: unknown[], stop_reason = "end_turn") {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: DEFAULT_ANTHROPIC_MODEL,
    content,
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

function fakeFetch(status: number, body: unknown) {
  const calls: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body ?? "{}")),
    });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", "request-id": "req_1" },
    });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

describe("Anthropic API provider", () => {
  it("asks for JSON matching the schema, with refusal fallback on, and parses the answer", async () => {
    const { fetch, calls } = fakeFetch(200, message([{ type: "text", text: '{"summary":"ok"}' }]));
    const provider = createAnthropicProvider({ apiKey: "sk-ant-test", fetch, maxRetries: 0 });

    expect(await provider.complete(request)).toEqual({ summary: "ok" });
    expect(provider).toMatchObject({ name: "anthropic", model: "claude-opus-5-5" });

    const call = calls[0]!;
    expect(call.url).toBe("https://api.anthropic.com/v1/messages");
    expect(call.headers.get("authorization")).toBe("Bearer sk-ant-test");
    expect(call.headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    expect(call.body).toMatchObject({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      fallbacks: "default",
      system: "You explain code.",
      messages: [{ role: "user", content: "<evidence>x</evidence>" }],
      output_config: { effort: "medium", format: { type: "json_schema", schema: request.schema } },
    });
  });

  it("uses a chosen model", async () => {
    const { fetch, calls } = fakeFetch(200, message([{ type: "text", text: "{}" }]));
    const provider = createAnthropicProvider({
      apiKey: "k",
      model: "claude-sonnet-5-5",
      fetch,
      maxRetries: 0,
    });
    await provider.complete(request);

    expect(provider.model).toBe("claude-sonnet-5-5");
    expect(calls[0]!.body["model"]).toBe("claude-sonnet-5-5");
  });

  it("needs an API key", () => {
    expect(() => createAnthropicProvider({})).toThrow(/Set ANTHROPIC_API_KEY/);
  });

  it("reports a refusal and a cut-off answer", async () => {
    const refused = fakeFetch(200, message([], "refusal"));
    await expect(
      createAnthropicProvider({ apiKey: "k", fetch: refused.fetch, maxRetries: 0 }).complete(
        request,
      ),
    ).rejects.toMatchObject({
      code: "AI_FAILED",
      message: "The model declined to answer this request",
    });

    const cut = fakeFetch(200, message([{ type: "text", text: '{"summ' }], "max_tokens"));
    await expect(
      createAnthropicProvider({ apiKey: "k", fetch: cut.fetch, maxRetries: 0 }).complete(request),
    ).rejects.toThrow("cut off");
  });

  it("reports text that is not JSON", async () => {
    const { fetch } = fakeFetch(200, message([{ type: "text", text: "Sure! Here you go" }]));
    await expect(
      createAnthropicProvider({ apiKey: "k", fetch, maxRetries: 0 }).complete(request),
    ).rejects.toThrow("did not return JSON");
  });

  it("turns API errors into clear messages", async () => {
    const cases: Array<[number, string, string]> = [
      [401, "AI_UNAVAILABLE", "The Anthropic API rejected ANTHROPIC_API_KEY"],
      [403, "AI_UNAVAILABLE", "This API key is not allowed to use the chosen model"],
      [429, "AI_FAILED", "Anthropic API rate limit reached, try again shortly"],
    ];
    for (const [status, code, text] of cases) {
      const { fetch } = fakeFetch(status, {
        type: "error",
        error: { type: "error", message: "nope" },
      });
      await expect(
        createAnthropicProvider({ apiKey: "k", fetch, maxRetries: 0 }).complete(request),
      ).rejects.toMatchObject({ code, message: text });
    }

    const { fetch } = fakeFetch(500, {
      type: "error",
      error: { type: "api_error", message: "down" },
    });
    await expect(
      createAnthropicProvider({ apiKey: "k", fetch, maxRetries: 0 }).complete(request),
    ).rejects.toMatchObject({
      code: "AI_FAILED",
      message: expect.stringMatching(/^Anthropic API error 500/),
    });
  });
});
