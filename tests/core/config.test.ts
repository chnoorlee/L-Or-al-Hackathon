import { describe, expect, it } from "vitest";

import { createCoreConfig, DEFAULT_CORE_CONFIG } from "../../miniprogram/core";

describe("core config", () => {
  it("exposes the documented provisional defaults", () => {
    expect(DEFAULT_CORE_CONFIG).toEqual({
      version: "mvp-v0.1",
      analysisMaxLongEdge: 1280,
      minValidPixelsPerRoi: 100,
      clippedPixelRatioWarn: 0.05,
      analysisTimeoutMs: 15_000,
      sessionIdleTtlMs: 300_000,
    });
  });

  it("merges validated overrides without mutating the defaults", () => {
    const config = createCoreConfig({ minValidPixelsPerRoi: 144 });
    expect(config.minValidPixelsPerRoi).toBe(144);
    expect(DEFAULT_CORE_CONFIG.minValidPixelsPerRoi).toBe(100);
    expect(Object.isFrozen(config)).toBe(true);
  });

  it.each([
    { analysisMaxLongEdge: 0 },
    { minValidPixelsPerRoi: 1.5 },
    { clippedPixelRatioWarn: -0.01 },
    { clippedPixelRatioWarn: 1.01 },
    { analysisTimeoutMs: Number.NaN },
    { sessionIdleTtlMs: -1 },
  ])("rejects invalid settings: %o", (overrides) => {
    expect(() => createCoreConfig(overrides)).toThrow();
  });
});
