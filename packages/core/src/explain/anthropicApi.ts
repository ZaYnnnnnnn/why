import Anthropic from "@anthropic-ai/sdk";
import { WhyError } from "../errors.ts";
import type { AiProvider, CompletionRequest } from "./provider.ts";

export interface AnthropicApiOptions {
  apiKey?: string | undefined;
  model?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  fetch?: typeof fetch;
  maxRetries?: number;
}

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";

export function createAnthropicProvider(options: AnthropicApiOptions = {}): AiProvider {
  const { apiKey, model = DEFAULT_ANTHROPIC_MODEL, effort = "medium", maxRetries = 2 } = options;

  if (!apiKey) {
    throw new WhyError(
      "AI_UNAVAILABLE",
      "Set ANTHROPIC_API_KEY to use --ai anthropic, or use --ai claude-cli with your Claude Code sign-in",
    );
  }

  const client = new Anthropic({
    apiKey,
    maxRetries,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });

  async function complete(request: CompletionRequest): Promise<unknown> {
    let response: Anthropic.Beta.Messages.BetaMessage;
    try {
      response = await client.beta.messages.create({
        model,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: request.system,
        messages: [{ role: "user", content: request.prompt }],
        output_config: {
          effort,
          format: { type: "json_schema", schema: request.schema },
        },
      });
    } catch (error) {
      throw toWhyError(error);
    }

    if (response.stop_reason === "refusal") {
      throw new WhyError("AI_FAILED", "The model declined to answer this request");
    }
    if (response.stop_reason === "max_tokens") {
      throw new WhyError("AI_FAILED", "The model's answer was cut off before it finished");
    }

    const text = response.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("");
    try {
      return JSON.parse(text);
    } catch {
      throw new WhyError("AI_FAILED", "The Anthropic API did not return JSON");
    }
  }

  return { name: "anthropic", model, complete };
}

function toWhyError(error: unknown): WhyError {
  if (error instanceof Anthropic.AuthenticationError) {
    return new WhyError("AI_UNAVAILABLE", "The Anthropic API rejected ANTHROPIC_API_KEY", {
      cause: error,
    });
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return new WhyError("AI_UNAVAILABLE", "This API key is not allowed to use the chosen model", {
      cause: error,
    });
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new WhyError("AI_FAILED", "Anthropic API rate limit reached, try again shortly", {
      cause: error,
    });
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new WhyError("AI_FAILED", "Could not reach the Anthropic API", { cause: error });
  }
  if (error instanceof Anthropic.APIError) {
    return new WhyError("AI_FAILED", `Anthropic API error ${error.status}: ${error.message}`, {
      cause: error,
    });
  }
  return new WhyError("AI_FAILED", `Anthropic API request failed: ${(error as Error).message}`, {
    cause: error,
  });
}
