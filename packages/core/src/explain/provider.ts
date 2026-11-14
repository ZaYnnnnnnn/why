export interface CompletionRequest {
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
}

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  complete: (request: CompletionRequest) => Promise<unknown>;
}
