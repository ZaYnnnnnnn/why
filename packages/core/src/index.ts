export { WhyError, isWhyError } from "./errors.ts";
export { createAnthropicProvider, DEFAULT_ANTHROPIC_MODEL } from "./explain/anthropicApi.ts";
export type { AnthropicApiOptions } from "./explain/anthropicApi.ts";
export { createClaudeCliProvider, runCommand } from "./explain/claudeCli.ts";
export type { ClaudeCliOptions, RunCommand, RunOptions, RunResult } from "./explain/claudeCli.ts";
export {
  checkExplanation,
  explainHistory,
  EXPLANATION_SCHEMA,
  PROMPT_VERSION,
  SYSTEM_PROMPT,
} from "./explain/explain.ts";
export type {
  Confidence,
  ExplainOptions,
  ExplainResult,
  Explanation,
  TimelineEntry,
} from "./explain/explain.ts";
export { buildEvidencePack, DEFAULT_PACK_CHARS } from "./explain/pack.ts";
export type { AiProvider, CompletionRequest } from "./explain/provider.ts";
export type { EvidencePack, EvidenceSource, PackOptions, SourceKind } from "./explain/pack.ts";
export type { WhyErrorCode } from "./errors.ts";
export { runGit } from "./git.ts";
export { findRepoRoot, toRepoPath } from "./repo.ts";
export { findMovedFrom } from "./findMovedFrom.ts";
export type { MoveMatch, MoveResult, MoveTarget, SourceLocation } from "./findMovedFrom.ts";
export { defaultCacheDir, explanationCacheDir, fileCache, memoryCache } from "./github/cache.ts";
export type { Cache, CacheEntry } from "./github/cache.ts";
export { createGitHubClient, FOREVER, ONE_WEEK } from "./github/client.ts";
export type { GetOptions, GitHubClient, GitHubClientOptions } from "./github/client.ts";
export { linkHistory, LIMITS, truncate } from "./github/linkHistory.ts";
export type {
  ChangeEvidence,
  CommentEvidence,
  IssueEvidence,
  LinkedChange,
  LinkedHistory,
  LinkOptions,
  PullRequestEvidence,
} from "./github/linkHistory.ts";
export { findIssueRefs } from "./github/refs.ts";
export type { IssueLink, IssueRef } from "./github/refs.ts";
export { findGitHubRepo, parseGitHubRemote, parseRepoSlug } from "./github/remote.ts";
export type { GitHubRepo } from "./github/remote.ts";
export { DEFAULT_MIN_LINE_SIMILARITY, parseLineLog, traceLine } from "./traceLine.ts";
export type { ChangeKind, LineChange, LineHistory, TraceOptions } from "./traceLine.ts";
export { mapLine, mapToCommittedLine, parseHunks } from "./workingLine.ts";
export type { Hunk, WorkingLine } from "./workingLine.ts";
