/** Thrown by a handler that must run again later (the queue gives up after MAX_JOB_ATTEMPTS). */
export class JobRetry extends Error {
  readonly retryAfterMs: number;

  /** `message` is stored in jobs.error: English, no secret. */
  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = "JobRetry";
    this.retryAfterMs = retryAfterMs;
  }
}
