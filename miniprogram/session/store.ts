import type {
  AnalysisCancelReason,
  AnalysisStage,
  AnalysisTaskToken,
  Clock,
  CommerceOperation,
  ImageSelection,
  ResourceCleanup,
  ResourceCleanupReason,
  SessionError,
  SessionImageIdentity,
  SessionResultIdentity,
  SessionSnapshot,
  SessionStoreOptions,
} from "./types";

const DEFAULT_IDLE_TTL_MS = 300_000;

const systemClock: Clock = {
  now: () => Date.now(),
};

type Listener<TImage, TSample, TResult> = (
  snapshot: SessionSnapshot<TImage, TSample, TResult>,
) => void;

type ActiveCancellation = (reason: AnalysisCancelReason) => void;

export class SessionStore<TImage = unknown, TSample = unknown, TResult = unknown> {
  private readonly clock: Clock;
  private readonly idleTtlMs: number;
  private readonly createSessionId: (now: number, sequence: number) => string;
  private readonly createTaskId: (now: number, sequence: number) => string;
  private readonly listeners = new Set<Listener<TImage, TSample, TResult>>();
  private sessionSequence = 0;
  private taskSequence = 0;
  private imageCleanup: ResourceCleanup | null = null;
  private activeCancellation: ActiveCancellation | null = null;
  private state: SessionSnapshot<TImage, TSample, TResult>;

  constructor(options: SessionStoreOptions) {
    if (!options.catalogVersion.trim()) {
      throw new Error("catalogVersion is required");
    }

    this.clock = options.clock ?? systemClock;
    this.idleTtlMs = options.idleTtlMs ?? DEFAULT_IDLE_TTL_MS;
    if (!Number.isFinite(this.idleTtlMs) || this.idleTtlMs <= 0) {
      throw new Error("idleTtlMs must be a positive finite number");
    }

    this.createSessionId =
      options.createSessionId ??
      ((now, sequence) => `session-${now}-${sequence}`);
    this.createTaskId =
      options.createTaskId ?? ((now, sequence) => `task-${now}-${sequence}`);
    this.state = this.emptySnapshot(0, options.catalogVersion);
  }

  getSnapshot(): SessionSnapshot<TImage, TSample, TResult> {
    return this.state;
  }

  getImageIdentity(): SessionImageIdentity | null {
    if (this.state.sessionId === null || this.state.imageVersion === null) {
      return null;
    }
    return Object.freeze({
      sessionId: this.state.sessionId,
      revision: this.state.revision,
      imageVersion: this.state.imageVersion,
    });
  }

  subscribe(listener: Listener<TImage, TSample, TResult>): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async access(): Promise<SessionSnapshot<TImage, TSample, TResult>> {
    await this.expireIfNeeded();
    return this.state;
  }

  async selectImage(
    selection: ImageSelection<TImage>,
  ): Promise<SessionImageIdentity> {
    if (!selection.imageVersion.trim()) {
      throw new Error("imageVersion is required");
    }

    const previousCleanup = this.imageCleanup;
    this.cancelActive("image_replaced");
    this.imageCleanup = selection.cleanup ?? null;

    const now = this.clock.now();
    this.sessionSequence += 1;
    const identity = Object.freeze({
      sessionId: this.createSessionId(now, this.sessionSequence),
      revision: this.state.revision + 1,
      imageVersion: selection.imageVersion,
    });
    this.replaceState({
      phase: "IMAGE_READY",
      sessionId: identity.sessionId,
      revision: identity.revision,
      imageVersion: identity.imageVersion,
      catalogVersion: this.state.catalogVersion,
      image: selection.image,
      sample: null,
      sampleConfirmed: false,
      analysis: null,
      result: null,
      error: null,
      commerce: { status: "idle" },
      createdAt: now,
      lastActivityAt: now,
    });

    await this.cleanupBestEffort(previousCleanup, "image_replaced");
    return identity;
  }

  materializeImage(
    identity: SessionImageIdentity,
    image: TImage,
  ): boolean {
    if (this.expireBeforeMutation()) {
      return false;
    }
    if (
      this.state.phase !== "IMAGE_READY" ||
      this.state.sample !== null ||
      this.state.sessionId !== identity.sessionId ||
      this.state.revision !== identity.revision ||
      this.state.imageVersion !== identity.imageVersion
    ) {
      return false;
    }

    this.replaceState({
      ...this.state,
      image,
      lastActivityAt: this.clock.now(),
    });
    return true;
  }

  setSample(
    identity: SessionImageIdentity,
    sample: TSample,
    confirmed: boolean,
  ): boolean {
    if (
      this.expireBeforeMutation() ||
      this.state.image === null ||
      !this.isCurrentImageIdentity(identity)
    ) {
      return false;
    }

    this.cancelActive("sample_changed");
    this.replaceState({
      ...this.state,
      phase: confirmed ? "ROI_READY" : "IMAGE_READY",
      revision: this.state.revision + 1,
      sample,
      sampleConfirmed: confirmed,
      analysis: null,
      result: null,
      error: null,
      commerce: { status: "idle" },
      lastActivityAt: this.clock.now(),
    });
    return true;
  }

  clearSample(identity: SessionImageIdentity): boolean {
    if (
      this.expireBeforeMutation() ||
      this.state.image === null ||
      !this.isCurrentImageIdentity(identity)
    ) {
      return false;
    }

    this.cancelActive("sample_changed");
    this.replaceState({
      ...this.state,
      phase: "IMAGE_READY",
      revision: this.state.revision + 1,
      sample: null,
      sampleConfirmed: false,
      analysis: null,
      result: null,
      error: null,
      commerce: { status: "idle" },
      lastActivityAt: this.clock.now(),
    });
    return true;
  }

  beginAnalysis(
    identity: SessionImageIdentity,
    onCancel: ActiveCancellation,
  ): AnalysisTaskToken | null {
    if (this.expireBeforeMutation()) {
      return null;
    }
    if (
      this.state.phase !== "ROI_READY" ||
      !this.state.sampleConfirmed ||
      this.state.sessionId === null ||
      this.state.imageVersion === null ||
      !this.isCurrentImageIdentity(identity)
    ) {
      return null;
    }

    const now = this.clock.now();
    this.taskSequence += 1;
    const token: AnalysisTaskToken = Object.freeze({
      sessionId: this.state.sessionId,
      revision: this.state.revision,
      taskId: this.createTaskId(now, this.taskSequence),
      imageVersion: this.state.imageVersion,
      catalogVersion: this.state.catalogVersion,
    });
    this.activeCancellation = onCancel;
    this.replaceState({
      ...this.state,
      phase: "ANALYZING",
      analysis: {
        token,
        stage: "checking_image",
        startedAt: now,
      },
      result: null,
      error: null,
      commerce: { status: "idle" },
      lastActivityAt: now,
    });
    return token;
  }

  setAnalysisStage(token: AnalysisTaskToken, stage: AnalysisStage): boolean {
    if (this.expireBeforeMutation()) {
      return false;
    }
    if (!this.isCurrentTask(token) || this.state.analysis === null) {
      return false;
    }

    this.replaceState({
      ...this.state,
      analysis: {
        ...this.state.analysis,
        stage,
      },
    });
    return true;
  }

  completeAnalysis(token: AnalysisTaskToken, result: TResult): boolean {
    if (this.expireBeforeMutation()) {
      return false;
    }
    if (!this.isCurrentTask(token)) {
      return false;
    }

    this.activeCancellation = null;
    this.replaceState({
      ...this.state,
      phase: "RESULT",
      analysis: null,
      result,
      error: null,
      commerce: { status: "idle" },
    });
    return true;
  }

  failAnalysis(token: AnalysisTaskToken, error: SessionError): boolean {
    if (this.expireBeforeMutation()) {
      return false;
    }
    if (!this.isCurrentTask(token)) {
      return false;
    }

    this.activeCancellation = null;
    this.replaceState({
      ...this.state,
      phase: "ROI_READY",
      analysis: null,
      result: null,
      error,
      commerce: { status: "idle" },
    });
    return true;
  }

  cancelAnalysis(
    token: AnalysisTaskToken,
    reason: AnalysisCancelReason,
    options: { readonly error?: SessionError; readonly touch?: boolean } = {},
  ): boolean {
    if (this.expireBeforeMutation()) {
      return false;
    }
    if (!this.isCurrentTask(token)) {
      return false;
    }

    this.cancelActive(reason);
    this.replaceState({
      ...this.state,
      phase: this.state.sampleConfirmed ? "ROI_READY" : "IMAGE_READY",
      revision: this.state.revision + 1,
      analysis: null,
      result: null,
      error: options.error ?? null,
      commerce: { status: "idle" },
      lastActivityAt:
        options.touch === false ? this.state.lastActivityAt : this.clock.now(),
    });
    return true;
  }

  invalidateCatalog(catalogVersion: string): boolean {
    if (!catalogVersion.trim()) {
      throw new Error("catalogVersion is required");
    }
    this.expireBeforeMutation();
    if (catalogVersion === this.state.catalogVersion) {
      return false;
    }

    this.cancelActive("catalog_changed");
    const phase = this.state.sampleConfirmed
      ? "ROI_READY"
      : this.state.image === null
        ? "EMPTY"
        : "IMAGE_READY";
    this.replaceState({
      ...this.state,
      phase,
      revision: this.state.revision + 1,
      catalogVersion,
      analysis: null,
      result: null,
      error: this.state.phase === "EMPTY" ? this.state.error : null,
      commerce: { status: "idle" },
    });
    return true;
  }

  setCommerceOperation(
    identity: SessionResultIdentity,
    operation: CommerceOperation,
  ): boolean {
    if (
      this.expireBeforeMutation() ||
      this.state.phase !== "RESULT" ||
      this.state.catalogVersion !== identity.catalogVersion ||
      !this.isCurrentImageIdentity(identity)
    ) {
      return false;
    }
    this.replaceState({
      ...this.state,
      commerce: operation,
    });
    return true;
  }

  touch(): void {
    if (this.expireBeforeMutation()) {
      return;
    }
    if (this.state.phase === "EMPTY") {
      return;
    }
    this.replaceState({
      ...this.state,
      lastActivityAt: this.clock.now(),
    });
  }

  isExpired(now = this.clock.now()): boolean {
    return (
      this.state.phase !== "EMPTY" &&
      this.state.lastActivityAt !== null &&
      now - this.state.lastActivityAt >= this.idleTtlMs
    );
  }

  async expireIfNeeded(): Promise<boolean> {
    if (!this.isExpired()) {
      return false;
    }

    await this.reset("expired", {
      code: "session_expired",
      message: "本次图片已清除，请重新选择。",
      retryable: true,
    });
    return true;
  }

  async restart(): Promise<void> {
    await this.reset("restart");
  }

  isCurrentTask(token: AnalysisTaskToken): boolean {
    const current = this.state.analysis?.token;
    return (
      !this.isExpired() &&
      this.state.phase === "ANALYZING" &&
      current !== undefined &&
      current.sessionId === token.sessionId &&
      current.revision === token.revision &&
      current.taskId === token.taskId &&
      current.imageVersion === token.imageVersion &&
      current.catalogVersion === token.catalogVersion
    );
  }

  private async reset(
    reason: Extract<AnalysisCancelReason, "expired" | "restart">,
    error: SessionError | null = null,
  ): Promise<void> {
    const cleanup = this.imageCleanup;
    this.imageCleanup = null;
    this.cancelActive(reason);
    this.replaceState({
      ...this.emptySnapshot(
        this.state.revision + 1,
        this.state.catalogVersion,
      ),
      error,
    });
    await this.cleanupBestEffort(cleanup, reason);
  }

  private expireBeforeMutation(): boolean {
    if (!this.isExpired()) {
      return false;
    }

    const cleanup = this.imageCleanup;
    this.imageCleanup = null;
    this.cancelActive("expired");
    this.replaceState({
      ...this.emptySnapshot(
        this.state.revision + 1,
        this.state.catalogVersion,
      ),
      error: {
        code: "session_expired",
        message: "本次图片已清除，请重新选择。",
        retryable: true,
      },
    });
    if (cleanup !== null) {
      void Promise.resolve()
        .then(() => cleanup("expired"))
        .catch(() => undefined);
    }
    return true;
  }

  private cancelActive(reason: AnalysisCancelReason): void {
    const cancellation = this.activeCancellation;
    this.activeCancellation = null;
    cancellation?.(reason);
  }

  private isCurrentImageIdentity(identity: SessionImageIdentity): boolean {
    return (
      this.state.sessionId === identity.sessionId &&
      this.state.revision === identity.revision &&
      this.state.imageVersion === identity.imageVersion
    );
  }

  private async cleanupBestEffort(
    cleanup: ResourceCleanup | null,
    reason: ResourceCleanupReason,
  ): Promise<void> {
    if (cleanup === null) {
      return;
    }
    try {
      await cleanup(reason);
    } catch (_error) {
      // Cleanup cannot invalidate the state transition that already completed.
    }
  }

  private replaceState(next: SessionSnapshot<TImage, TSample, TResult>): void {
    this.state = Object.freeze(next);
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  private emptySnapshot(
    revision: number,
    catalogVersion: string,
  ): SessionSnapshot<TImage, TSample, TResult> {
    return Object.freeze({
      phase: "EMPTY",
      sessionId: null,
      revision,
      imageVersion: null,
      catalogVersion,
      image: null,
      sample: null,
      sampleConfirmed: false,
      analysis: null,
      result: null,
      error: null,
      commerce: { status: "idle" as const },
      createdAt: null,
      lastActivityAt: null,
    });
  }
}

