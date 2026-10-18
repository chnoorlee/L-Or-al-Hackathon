export interface CoreConfig {
  readonly version: string;
  readonly analysisMaxLongEdge: number;
  readonly minValidPixelsPerRoi: number;
  readonly clippedPixelRatioWarn: number;
  readonly analysisTimeoutMs: number;
  readonly sessionIdleTtlMs: number;
}

export const DEFAULT_CORE_CONFIG: Readonly<CoreConfig> = Object.freeze({
  version: "mvp-v0.1",
  analysisMaxLongEdge: 1280,
  minValidPixelsPerRoi: 100,
  clippedPixelRatioWarn: 0.05,
  analysisTimeoutMs: 15_000,
  sessionIdleTtlMs: 300_000,
});

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
}

export function createCoreConfig(
  overrides: Partial<CoreConfig> = {},
): Readonly<CoreConfig> {
  const config: CoreConfig = { ...DEFAULT_CORE_CONFIG, ...overrides };

  if (typeof config.version !== "string" || config.version.trim() === "") {
    throw new TypeError("version must be a non-empty string");
  }

  assertPositiveInteger(config.analysisMaxLongEdge, "analysisMaxLongEdge");
  assertPositiveInteger(config.minValidPixelsPerRoi, "minValidPixelsPerRoi");
  assertPositiveInteger(config.analysisTimeoutMs, "analysisTimeoutMs");
  assertPositiveInteger(config.sessionIdleTtlMs, "sessionIdleTtlMs");

  if (
    !Number.isFinite(config.clippedPixelRatioWarn) ||
    config.clippedPixelRatioWarn < 0 ||
    config.clippedPixelRatioWarn > 1
  ) {
    throw new RangeError("clippedPixelRatioWarn must be between 0 and 1");
  }

  return Object.freeze(config);
}
