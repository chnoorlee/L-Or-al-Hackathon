import {
  AnalysisCancellationController,
  AnalysisCancelledError,
} from "./cancellation";
import { SessionStore } from "./store";
import type {
  AnalysisCancelReason,
  AnalysisContext,
  AnalysisRunOutcome,
  ResourceCleanup,
  ResourceCleanupReason,
  SessionError,
  SessionImageIdentity,
  Clock,
} from "./types";

export interface TimerApi {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface AnalysisCoordinatorOptions {
  readonly timeoutMs?: number;
  readonly timers?: TimerApi;
  readonly clock?: Clock;
}

const systemTimers: TimerApi = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) =>
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

const systemClock: Clock = {
  now: () => Date.now(),
};

const timeoutError: SessionError = {
  code: "analysis_timeout",
  message: "分析超时，请调整取样后重试。",
  retryable: true,
};

const analysisError: SessionError = {
  code: "analysis_failed",
  message: "本次分析未完成，请重试。",
  retryable: true,
};

type BareAnalysisRunOutcome<TResult> =
  | { readonly kind: "completed"; readonly result: TResult }
  | { readonly kind: "failed"; readonly error: SessionError }
  | {
      readonly kind: "cancelled";
      readonly reason: Exclude<AnalysisCancelReason, "timeout">;
    }
  | { readonly kind: "timeout" }
  | { readonly kind: "stale" };

export class AnalysisCoordinator<
  TImage = unknown,
  TSample = unknown,
  TResult = unknown,
> {
  private readonly timeoutMs: number;
  private readonly timers: TimerApi;
  private readonly clock: Clock;

  constructor(
    private readonly store: SessionStore<TImage, TSample, TResult>,
    options: AnalysisCoordinatorOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? 15_000;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error("timeoutMs must be a positive finite number");
    }
    this.timers = options.timers ?? systemTimers;
    this.clock = options.clock ?? systemClock;
  }

  async run(
    worker: (context: AnalysisContext) => Promise<TResult>,
    expectedIdentity: SessionImageIdentity | null = this.store.getImageIdentity(),
  ): Promise<AnalysisRunOutcome<TResult>> {
    const cancellation = new AnalysisCancellationController();
    const cleanups: ResourceCleanup[] = [];
    let finalCleanupReason: ResourceCleanupReason | null = null;
    if (expectedIdentity === null) {
      return { kind: "stale", cleanupErrors: [] };
    }
    const token = this.store.beginAnalysis(expectedIdentity, (reason) => {
      cancellation.cancel(reason);
    });
    if (token === null) {
      return { kind: "stale", cleanupErrors: [] };
    }

    const context: AnalysisContext = {
      token,
      signal: cancellation.signal,
      setStage: (stage) => this.store.setAnalysisStage(token, stage),
      deferCleanup: (cleanup) => {
        if (finalCleanupReason === null) {
          cleanups.push(cleanup);
          return;
        }

        void Promise.resolve()
          .then(() => cleanup(finalCleanupReason!))
          .catch(() => undefined);
      },
    };

    const deadlineAt = this.clock.now() + this.timeoutMs;
    const timerHandle = this.timers.setTimeout(() => {
      this.timeoutTask(token);
    }, this.timeoutMs);

    const work = this.runWorker(worker, context, cancellation, deadlineAt);
    const cancelled = cancellation.signal.whenCancelled.then((reason) =>
      this.cancelOutcome<TResult>(reason),
    );
    const outcome = await Promise.race([work, cancelled]);
    this.timers.clearTimeout(timerHandle);
    finalCleanupReason = this.cleanupReason(outcome);
    const cleanupErrors = await this.releaseTaskResources(
      cleanups,
      finalCleanupReason,
    );
    return { ...outcome, cleanupErrors };
  }

  cancel(reason: Extract<AnalysisCancelReason, "user" | "hidden">): boolean {
    const token = this.store.getSnapshot().analysis?.token;
    if (token === undefined) {
      return false;
    }
    return this.store.cancelAnalysis(token, reason, {
      touch: reason === "user",
    });
  }

  private async runWorker(
    worker: (context: AnalysisContext) => Promise<TResult>,
    context: AnalysisContext,
    cancellation: AnalysisCancellationController,
    deadlineAt: number,
  ): Promise<BareAnalysisRunOutcome<TResult>> {
    try {
      const result = await worker(context);
      if (this.clock.now() >= deadlineAt && this.timeoutTask(context.token)) {
        return { kind: "timeout" };
      }
      cancellation.signal.throwIfCancelled();
      return this.store.completeAnalysis(context.token, result)
        ? { kind: "completed", result }
        : { kind: "stale" };
    } catch (error) {
      if (error instanceof AnalysisCancelledError) {
        return this.cancelOutcome<TResult>(error.reason);
      }
      if (cancellation.signal.reason !== null) {
        return this.cancelOutcome<TResult>(cancellation.signal.reason);
      }
      if (this.clock.now() >= deadlineAt && this.timeoutTask(context.token)) {
        return { kind: "timeout" };
      }
      return this.store.failAnalysis(context.token, analysisError)
        ? { kind: "failed", error: analysisError }
        : { kind: "stale" };
    }
  }

  private timeoutTask(token: AnalysisContext["token"]): boolean {
    return this.store.cancelAnalysis(token, "timeout", {
      error: timeoutError,
      touch: false,
    });
  }

  private cancelOutcome<TResultValue>(
    reason: AnalysisCancelReason,
  ): BareAnalysisRunOutcome<TResultValue> {
    return reason === "timeout"
      ? { kind: "timeout" }
      : {
          kind: "cancelled",
          reason: reason as Exclude<AnalysisCancelReason, "timeout">,
        };
  }

  private async releaseTaskResources(
    cleanups: readonly ResourceCleanup[],
    reason: ResourceCleanupReason,
  ): Promise<readonly unknown[]> {
    const errors: unknown[] = [];
    for (const cleanup of [...cleanups].reverse()) {
      try {
        await cleanup(reason);
      } catch (error) {
        errors.push(error);
      }
    }
    return errors;
  }

  private cleanupReason<TResultValue>(
    outcome: BareAnalysisRunOutcome<TResultValue>,
  ): ResourceCleanupReason {
    if (outcome.kind === "completed") {
      return "completed";
    }
    if (outcome.kind === "failed") {
      return "failed";
    }
    if (outcome.kind === "stale") {
      return "stale";
    }
    return outcome.kind === "timeout" ? "timeout" : outcome.reason;
  }
}

