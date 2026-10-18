import {
  DEFAULT_CORE_CONFIG,
  type CaptureEvidence,
  type ColorSummary,
  type NormalizedCircle,
  type Recommendation,
} from "../core/index";
import {
  createAnalysisImagePlan,
  type AnalysisImagePlan,
  type ChosenImage,
  type FixedAnalysisImage,
} from "../adapters/media/index";
import { PRODUCTION_CATALOG_VERSION } from "../data/catalog.production";
import { AnalysisCoordinator } from "./analysis-coordinator";
import { SessionStore } from "./store";
import type {
  Clock,
  ResourceCleanup,
  SessionImageIdentity,
} from "./types";

export interface AppSessionImage {
  readonly analysisPlan: AnalysisImagePlan;
  readonly analysis: FixedAnalysisImage | null;
  readonly previewRef: string;
  readonly captureEvidence: CaptureEvidence;
}

export interface SamplePair {
  readonly coverCircle: NormalizedCircle | null;
  readonly referenceCircle: NormalizedCircle | null;
  readonly confirmed: boolean;
  readonly revision: number;
}

export interface AnalysisResult {
  readonly recommendation: Recommendation;
  readonly colorSummary: ColorSummary;
  readonly previewColors: {
    readonly cover: string;
    readonly reference: string;
  };
}

export interface ApplicationSessionRuntimeOptions {
  readonly catalogVersion?: string;
  readonly idleTtlMs?: number;
  readonly analysisTimeoutMs?: number;
  readonly clock?: Clock;
}

const uncalibratedCaptureEvidence: CaptureEvidence = Object.freeze({
  calibrationMode: "uncalibrated",
  measurementProtocolId: null,
  comparisonGroupId: null,
  captureProfileId: null,
  colorTransformRef: null,
  evidenceRef: null,
  verificationStatus: "unverified",
});

export class ApplicationSessionRuntime {
  readonly store: SessionStore<AppSessionImage, SamplePair, AnalysisResult>;
  readonly analysis: AnalysisCoordinator<
    AppSessionImage,
    SamplePair,
    AnalysisResult
  >;

  private imageSequence = 0;

  constructor(options: ApplicationSessionRuntimeOptions = {}) {
    this.store = new SessionStore({
      catalogVersion:
        options.catalogVersion ?? PRODUCTION_CATALOG_VERSION,
      idleTtlMs: options.idleTtlMs ?? DEFAULT_CORE_CONFIG.sessionIdleTtlMs,
      ...(options.clock === undefined ? {} : { clock: options.clock }),
    });
    this.analysis = new AnalysisCoordinator(this.store, {
      timeoutMs:
        options.analysisTimeoutMs ?? DEFAULT_CORE_CONFIG.analysisTimeoutMs,
      ...(options.clock === undefined ? {} : { clock: options.clock }),
    });
  }

  async selectImage(
    source: ChosenImage,
    cleanup?: ResourceCleanup,
  ): Promise<SessionImageIdentity> {
    this.imageSequence += 1;
    const imageVersion = `image-${this.imageSequence}`;
    const analysisPlan = createAnalysisImagePlan(
      source,
      DEFAULT_CORE_CONFIG.analysisMaxLongEdge,
    );
    return this.store.selectImage({
      imageVersion,
      image: {
        analysisPlan,
        analysis: null,
        previewRef: source.tempFilePath,
        captureEvidence: uncalibratedCaptureEvidence,
      },
      ...(cleanup === undefined ? {} : { cleanup }),
    });
  }

  materializeImage(
    identity: SessionImageIdentity,
    analysis: FixedAnalysisImage,
    previewRef: string,
  ): boolean {
    const snapshot = this.store.getSnapshot();
    const image = snapshot.image;
    if (
      image === null ||
      !previewRef.trim() ||
      analysis.sourceImageVersion !== identity.imageVersion ||
      analysis.plan !== image.analysisPlan ||
      analysis.width !== image.analysisPlan.width ||
      analysis.height !== image.analysisPlan.height ||
      analysis.data.length !== analysis.width * analysis.height * 4
    ) {
      return false;
    }

    return this.store.materializeImage(identity, {
      ...image,
      analysis,
      previewRef,
    });
  }
}

export const appSessionRuntime = new ApplicationSessionRuntime();
export const appSessionStore = appSessionRuntime.store;
export const appAnalysisCoordinator = appSessionRuntime.analysis;
