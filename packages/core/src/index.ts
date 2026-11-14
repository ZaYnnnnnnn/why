export { WhyError, isWhyError } from "./errors.ts";
export type { WhyErrorCode } from "./errors.ts";
export { runGit } from "./git.ts";
export { findRepoRoot, toRepoPath } from "./repo.ts";
export { parseLineLog, traceLine } from "./traceLine.ts";
export type { ChangeKind, LineChange, LineHistory, TraceOptions } from "./traceLine.ts";
