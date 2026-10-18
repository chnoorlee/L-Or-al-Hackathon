import type {
  AnalysisCancelReason,
  AnalysisCancellationSignal,
} from "./types";

export class AnalysisCancelledError extends Error {
  constructor(readonly reason: AnalysisCancelReason) {
    super(`Analysis cancelled: ${reason}`);
    this.name = "AnalysisCancelledError";
  }
}

export class AnalysisCancellationController {
  private currentReason: AnalysisCancelReason | null = null;
  private readonly listeners = new Set<(reason: AnalysisCancelReason) => void>();
  private resolveCancellation!: (reason: AnalysisCancelReason) => void;

  readonly signal: AnalysisCancellationSignal;

  constructor() {
    const controller = this;
    const whenCancelled = new Promise<AnalysisCancelReason>((resolve) => {
      this.resolveCancellation = resolve;
    });

    this.signal = {
      get cancelled() {
        return controller.currentReason !== null;
      },
      get reason() {
        return controller.currentReason;
      },
      whenCancelled,
      throwIfCancelled: () => {
        if (this.currentReason !== null) {
          throw new AnalysisCancelledError(this.currentReason);
        }
      },
      onCancel: (listener) => this.onCancel(listener),
    };
  }

  cancel(reason: AnalysisCancelReason): boolean {
    if (this.currentReason !== null) {
      return false;
    }

    this.currentReason = reason;
    this.resolveCancellation(reason);
    for (const listener of [...this.listeners]) {
      listener(reason);
    }
    this.listeners.clear();
    return true;
  }

  private onCancel(listener: (reason: AnalysisCancelReason) => void): () => void {
    if (this.currentReason !== null) {
      listener(this.currentReason);
      return () => undefined;
    }

    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

