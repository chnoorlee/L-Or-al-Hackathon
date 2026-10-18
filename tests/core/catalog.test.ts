import { describe, expect, it } from "vitest";

import {
  isComparableEvidence,
  recommendCatalogEntries,
  validateCatalog,
  type CaptureEvidence,
  type CatalogEntry,
  type ColorEvidence,
  type RecommendationRequest,
} from "../../miniprogram/core";

const controlledCapture: CaptureEvidence = {
  calibrationMode: "controlled",
  measurementProtocolId: "protocol-1",
  comparisonGroupId: "group-1",
  captureProfileId: "device-profile-1",
  colorTransformRef: null,
  evidenceRef: "capture-review-1",
  verificationStatus: "verified",
};

function rawEntry(
  skuId: string,
  lab = { l: 50, a: 0, b: 0 },
): Record<string, unknown> {
  return {
    catalogVersion: "catalog-v1",
    brand: "Verified Brand",
    productId: "product-1",
    skuId,
    shadeCode: skuId,
    shadeName: `Shade ${skuId}`,
    name: "Verified Product",
    imageAsset: `/assets/${skuId}.png`,
    sourceUrl: `https://example.test/products/${skuId}`,
    verifiedAt: "2026-10-15",
    availability: "available",
    colorEvidence: {
      kind: "physical_swatch",
      measurementProtocolId: "protocol-1",
      comparisonGroupId: "group-1",
      captureProfileId: "device-profile-1",
      colorTransformRef: null,
      lab,
      applicableScopes: ["cheek"],
      evidenceRef: `evidence-${skuId}`,
      verificationStatus: "verified",
    },
    commerceRoute: null,
  };
}

function validate(entries: readonly unknown[]): readonly CatalogEntry[] {
  const result = validateCatalog(entries, "catalog-v1");
  expect(result.rejected).toEqual([]);
  return result.entries;
}

function request(overrides: Partial<RecommendationRequest> = {}): RecommendationRequest {
  return {
    catalogVersion: "catalog-v1",
    sessionRevision: 3,
    referenceLab: { l: 50, a: 0, b: 0 },
    targetScope: "cheek",
    captureEvidence: controlledCapture,
    ...overrides,
  };
}

describe("strict catalog admission", () => {
  it("admits a complete, source-traceable entry", () => {
    const result = validateCatalog([rawEntry("SKU-1")], "catalog-v1");
    expect(result.entries).toHaveLength(1);
    expect(result.rejected).toEqual([]);
    expect(result.commerceWarnings).toEqual([]);
  });

  it("rejects every occurrence of a duplicate SKU", () => {
    const result = validateCatalog(
      [rawEntry("DUPLICATE"), rawEntry("DUPLICATE")],
      "catalog-v1",
    );
    expect(result.entries).toEqual([]);
    expect(result.rejected.map((issue) => issue.code)).toEqual([
      "DUPLICATE_SKU",
      "DUPLICATE_SKU",
    ]);
  });

  it("does not admit a valid row when a malformed row duplicates its SKU", () => {
    const malformedDuplicate = rawEntry("DUPLICATE");
    (malformedDuplicate.colorEvidence as Record<string, unknown>).lab = null;
    const result = validateCatalog(
      [rawEntry("DUPLICATE"), malformedDuplicate],
      "catalog-v1",
    );
    expect(result.entries).toEqual([]);
    expect(result.rejected.map((issue) => issue.code)).toEqual([
      "DUPLICATE_SKU",
      "INVALID_COLOR_EVIDENCE",
    ]);
  });

  it("rejects missing ranked evidence rather than filling color values", () => {
    const entry = rawEntry("NO-LAB");
    (entry.colorEvidence as Record<string, unknown>).lab = null;
    const result = validateCatalog([entry], "catalog-v1");
    expect(result.entries).toEqual([]);
    expect(result.rejected[0]?.code).toBe("INVALID_COLOR_EVIDENCE");
  });

  it("keeps valid color evidence but disables an invalid commerce route", () => {
    const entry = rawEntry("SKU-1");
    entry.commerceRoute = {
      kind: "mini_program",
      verifiedAt: "2026-10-15",
      productId: "wrong-product",
      skuId: "SKU-1",
      appId: "wx123",
      path: "/product",
      url: null,
      skuPreselectVerified: true,
      deviceEvidenceRef: "device-video-1",
    };
    const result = validateCatalog([entry], "catalog-v1");
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.commerceRoute).toBeNull();
    expect(result.commerceWarnings[0]?.code).toBe("INVALID_COMMERCE_ROUTE");
  });

  it("rejects entries from a different catalog version", () => {
    const entry = rawEntry("SKU-1");
    entry.catalogVersion = "catalog-v2";
    const result = validateCatalog([entry], "catalog-v1");
    expect(result.entries).toEqual([]);
    expect(result.rejected[0]?.code).toBe("CATALOG_VERSION_MISMATCH");
  });

  it("rejects calendar dates that JavaScript would otherwise roll forward", () => {
    const entry = rawEntry("BAD-DATE");
    entry.verifiedAt = "2026-02-31";
    const result = validateCatalog([entry], "catalog-v1");
    expect(result.entries).toEqual([]);
    expect(result.rejected[0]?.code).toBe("INVALID_ENTRY");
  });
});

describe("evidence comparability", () => {
  const swatch = (rawEntry("SKU-1").colorEvidence ?? {}) as ColorEvidence;

  it("requires reviewed controlled capture evidence, not just matching IDs", () => {
    expect(isComparableEvidence(controlledCapture, swatch)).toBe(true);
    expect(
      isComparableEvidence(
        { ...controlledCapture, calibrationMode: "uncalibrated" },
        swatch,
      ),
    ).toBe(false);
    expect(
      isComparableEvidence(
        { ...controlledCapture, verificationStatus: "unverified" },
        swatch,
      ),
    ).toBe(false);
    expect(
      isComparableEvidence({ ...controlledCapture, evidenceRef: null }, swatch),
    ).toBe(false);
  });

  it("rejects mismatched groups and web display colors", () => {
    expect(
      isComparableEvidence(controlledCapture, {
        ...swatch,
        comparisonGroupId: "other-group",
      }),
    ).toBe(false);
    expect(
      isComparableEvidence(controlledCapture, { ...swatch, kind: "web_display" }),
    ).toBe(false);
  });
});

describe("deterministic recommendation", () => {
  it("reports missing catalog data independently of photo calibration", () => {
    const result = recommendCatalogEntries(request({
      captureEvidence: { ...controlledCapture, calibrationMode: "uncalibrated" },
    }), []);
    expect(result.status).toBe("no_candidate");
    expect(result.reasonCodes).toEqual(["UNCALIBRATED_INPUT", "CATALOG_EMPTY"]);
  });

  it("revalidates catalog input and fails closed on duplicate typed rows", () => {
    const duplicate = rawEntry("DUP");
    const unsafeTypedInput = [duplicate, duplicate] as unknown as readonly CatalogEntry[];
    const result = recommendCatalogEntries(request(), unsafeTypedInput);
    expect(result.status).toBe("no_candidate");
    expect(result.reasonCodes).toContain("NO_ELIGIBLE_CATALOG_ENTRIES");
    expect(result.candidates).toEqual([]);
  });
  it("sorts by DeltaE00, breaks exact ties by stable SKU ID, and caps output at two", () => {
    const entries = validate([
      rawEntry("SKU-B"),
      rawEntry("SKU-FAR", { l: 80, a: 20, b: 20 }),
      rawEntry("SKU-A"),
      rawEntry("SKU-NEXT", { l: 51, a: 0, b: 0 }),
    ]);
    const result = recommendCatalogEntries(request(), entries);
    expect(result.status).toBe("ranked");
    expect(result.basis).toBe("controlled_color_comparison");
    expect(result.candidates.map((candidate) => candidate.entry.skuId)).toEqual([
      "SKU-A",
      "SKU-B",
    ]);
    expect(result.candidates).toHaveLength(2);
  });

  it("does not rank an ordinary uncalibrated photo", () => {
    const entries = validate([rawEntry("SKU-1")]);
    const result = recommendCatalogEntries(
      request({
        captureEvidence: {
          ...controlledCapture,
          calibrationMode: "uncalibrated",
          measurementProtocolId: null,
          comparisonGroupId: null,
          captureProfileId: null,
          evidenceRef: null,
          verificationStatus: "unverified",
        },
      }),
      entries,
    );
    expect(result.status).toBe("no_candidate");
    expect(result.candidates).toEqual([]);
    expect(result.reasonCodes).toEqual(["UNCALIBRATED_INPUT"]);
  });

  it("does not rank a webpage display color even if it contains a Lab value", () => {
    const entry = rawEntry("WEB");
    (entry.colorEvidence as Record<string, unknown>).kind = "web_display";
    const entries = validate([entry]);
    expect(recommendCatalogEntries(request(), entries).status).toBe("no_candidate");
  });

  it("enables unranked family references only with an explicit verified mapping", () => {
    const familyEntry = rawEntry("FAMILY-B");
    familyEntry.colorEvidence = {
      kind: "official_color_family",
      measurementProtocolId: null,
      comparisonGroupId: null,
      captureProfileId: null,
      colorTransformRef: null,
      lab: null,
      applicableScopes: ["cheek"],
      evidenceRef: "official-family-source",
      verificationStatus: "verified",
    };
    const entries = validate([familyEntry]);
    expect(recommendCatalogEntries(request(), entries).status).toBe("no_candidate");

    const result = recommendCatalogEntries(
      request({
        officialReferenceMapping: {
          verificationStatus: "verified",
          evidenceRef: "manual-map-review-1",
          shadeCodes: ["FAMILY-B"],
        },
      }),
      entries,
    );
    expect(result.status).toBe("reference_only");
    expect(result.candidates[0]?.deltaE00).toBeNull();
    expect(result.reasonCodes).toEqual(["NO_COLOR_DISTANCE_RANKING"]);
  });

  it("filters unavailable shades and out-of-scope evidence", () => {
    const unavailable = rawEntry("NO-STOCK");
    unavailable.availability = "unavailable";
    const wrongScope = rawEntry("WRONG-SCOPE");
    (wrongScope.colorEvidence as Record<string, unknown>).applicableScopes = ["forehead"];
    const result = recommendCatalogEntries(
      request(),
      validate([unavailable, wrongScope]),
    );
    expect(result.status).toBe("no_candidate");
    expect(result.reasonCodes).toContain("NO_ELIGIBLE_CATALOG_ENTRIES");
  });
});
