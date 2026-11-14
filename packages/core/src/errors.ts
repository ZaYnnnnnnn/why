export type WhyErrorCode =
  "NOT_A_REPO" | "FILE_NOT_FOUND" | "LINE_OUT_OF_RANGE" | "INVALID_ARGUMENT" | "GIT_FAILED";

export class WhyError extends Error {
  readonly code: WhyErrorCode;

  constructor(code: WhyErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WhyError";
    this.code = code;
  }
}

export function isWhyError(error: unknown, code?: WhyErrorCode): error is WhyError {
  return error instanceof WhyError && (code === undefined || error.code === code);
}
