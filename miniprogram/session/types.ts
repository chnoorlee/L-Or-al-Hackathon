export type FlowPhase =
  | "EMPTY"
  | "IMAGE_READY"
  | "ROI_READY"
  | "ANALYZING"
  | "RESULT";

export type AnalysisStage =
  | "checking_image"
  | "extracting_color"
  | "finding_candidates";

export type AnalysisCancelReason =
  | "user"
  | "hidden"
  | "timeout"
  | "sample_changed"
  | "image_replaced"
  | "catalog_changed"
  | "expired"
  | "restart";

export type SessionErrorCode =
  | "analysis_failed"
  | "analysis_timeout"
  | "session_expired";

export interface SessionError {
  readonly code: SessionErrorCode;
  readonly message: string;
  readonly retryable: boolean;
}

export interface AnalysisTaskToken {
  readonly sessionId: string;
  readonly revision: number;
  readonly taskId: string;
  readonly imageVersion: string;
  readonly catalogVersion: string;
}

export interface SessionImageIdentity {
  readonly sessionId: string;
  readonly revision: number;
  readonly imageVersion: string;
}

export interface SessionResultIdentity extends SessionImageIdentity {
  readonly catalogVersion: string;
}

export interface AnalysisTaskSnapshot {
  readonly token: AnalysisTaskToken;
  readonly stage: AnalysisStage;
  readonly startedAt: number;
}

export type CommerceOperation =
  | { readonly status: "idle" }
  | { readonly status: "opening"; readonly skuId: string }
  | {
      readonly status: "failed";
      readonly skuId: string;
      readonly message: string;
    };

export interface SessionSnapshot<
  TImage = unknown,
  TSample = unknown,
  TResult = unknown,
> {
  readonly phase: FlowPhase;
  readonly sessionId: string | null;
  readonly revision: number;
  readonly imageVersion: string | null;
  readonly catalogVersion: string;
  readonly image: TImage | null;
  readonly sample: TSample | null;
  readonly sampleConfirmed: boolean;
  readonly analysis: AnalysisTaskSnapshot | null;
  readonly result: TResult | null;
  readonly error: SessionError | null;
  readonly commerce: CommerceOperation;
  readonly createdAt: number | null;
  readonly lastActivityAt: number | null;
}

export interface Clock {
  now(): number;
}

export interface SessionStoreOptions {
  readonly catalogVersion: string;
  readonly idleTtlMs?: number;
  readonly clock?: Clock;
  readonly createSessionId?: (now: number, sequence: number) => string;
  readonly createTaskId?: (now: number, sequence: number) => string;
}

export type ResourceCleanupReason =
  | AnalysisCancelReason
  | "completed"
  | "failed"
  | "stale";

export type ResourceCleanup = (
  reason: ResourceCleanupReason,
) => void | Promise<void>;

export interface ImageSelection<TImage> {
  readonly image: TImage;
  readonly imageVersion: string;
  readonly cleanup?: ResourceCleanup;
}

export interface AnalysisCancellationSignal {
  readonly cancelled: boolean;
  readonly reason: AnalysisCancelReason | null;
  readonly whenCancelled: Promise<AnalysisCancelReason>;
  throwIfCancelled(): void;
  onCancel(listener: (reason: AnalysisCancelReason) => void): () => void;
}

export interface AnalysisContext {
  readonly token: AnalysisTaskToken;
  readonly signal: AnalysisCancellationSignal;
  setStage(stage: AnalysisStage): boolean;
  deferCleanup(cleanup: ResourceCleanup): void;
}

export type AnalysisRunOutcome<TResult> =
  | {
      readonly kind: "completed";
      readonly result: TResult;
      readonly cleanupErrors: readonly unknown[];
    }
  | {
      readonly kind: "failed";
      readonly error: SessionError;
      readonly cleanupErrors: readonly unknown[];
    }
  | {
      readonly kind: "cancelled";
      readonly reason: Exclude<AnalysisCancelReason, "timeout">;
      readonly cleanupErrors: readonly unknown[];
    }
  | {
      readonly kind: "timeout";
      readonly cleanupErrors: readonly unknown[];
    }
  | {
      readonly kind: "stale";
      readonly cleanupErrors: readonly unknown[];
    };

