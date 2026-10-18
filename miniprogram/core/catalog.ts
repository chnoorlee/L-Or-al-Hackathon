import { isValidLab } from "./color";
import { deltaE2000 } from "./delta-e";
import type {
  Availability,
  CaptureEvidence,
  CatalogEntry,
  ColorEvidence,
  ColorEvidenceKind,
  CommerceRoute,
  CommerceRouteKind,
  Recommendation,
  RecommendationCandidate,
  RecommendationRequest,
  VerificationStatus,
} from "./types";

export type CatalogIssueCode =
  | "INVALID_ENTRY"
  | "CATALOG_VERSION_MISMATCH"
  | "DUPLICATE_SKU"
  | "INVALID_COLOR_EVIDENCE"
  | "INVALID_COMMERCE_ROUTE";

export interface CatalogIssue {
  readonly index: number;
  readonly skuId: string | null;
  readonly code: CatalogIssueCode;
  readonly detail: string;
}

export interface CatalogValidationResult {
  readonly entries: readonly CatalogEntry[];
  readonly rejected: readonly CatalogIssue[];
  readonly commerceWarnings: readonly CatalogIssue[];
}

const AVAILABILITIES = new Set<Availability>([
  "available",
  "unavailable",
  "unknown",
]);
const EVIDENCE_KINDS = new Set<ColorEvidenceKind>([
  "physical_swatch",
  "applied_dry",
  "official_color_family",
  "web_display",
]);
const VERIFICATION_STATUSES = new Set<VerificationStatus>([
  "verified",
  "unverified",
]);
const ROUTE_KINDS = new Set<CommerceRouteKind>([
  "mini_program",
  "official_web",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function nullableString(value: unknown): value is string | null {
  return value === null || nonEmptyString(value);
}

function stringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => nonEmptyString(item))
  );
}

function isIsoDate(value: unknown): value is string {
  if (!nonEmptyString(value)) {
    return false;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z)?$/.exec(
    value,
  );
  if (match === null) {
    return false;
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, millisecondText] =
    match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText ?? 0);
  const minute = Number(minuteText ?? 0);
  const second = Number(secondText ?? 0);
  const millisecond = Number(millisecondText ?? 0);
  const parsed = new Date(
    Date.UTC(year, month - 1, day, hour, minute, second, millisecond),
  );
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day &&
    parsed.getUTCHours() === hour &&
    parsed.getUTCMinutes() === minute &&
    parsed.getUTCSeconds() === second &&
    parsed.getUTCMilliseconds() === millisecond
  );
}

function isHttpsUrl(value: unknown): value is string {
  return nonEmptyString(value) && /^https:\/\/[^\s]+$/i.test(value);
}

function parseColorEvidence(value: unknown): ColorEvidence | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    !EVIDENCE_KINDS.has(value.kind as ColorEvidenceKind) ||
    !nullableString(value.measurementProtocolId) ||
    !nullableString(value.comparisonGroupId) ||
    !nullableString(value.captureProfileId) ||
    !nullableString(value.colorTransformRef) ||
    !(value.lab === null || isValidLab(value.lab)) ||
    !stringArray(value.applicableScopes) ||
    !nonEmptyString(value.evidenceRef) ||
    !VERIFICATION_STATUSES.has(value.verificationStatus as VerificationStatus)
  ) {
    return null;
  }

  const evidence: ColorEvidence = {
    kind: value.kind as ColorEvidenceKind,
    measurementProtocolId: value.measurementProtocolId as string | null,
    comparisonGroupId: value.comparisonGroupId as string | null,
    captureProfileId: value.captureProfileId as string | null,
    colorTransformRef: value.colorTransformRef as string | null,
    lab: value.lab as ColorEvidence["lab"],
    applicableScopes: [...(value.applicableScopes as string[])],
    evidenceRef: value.evidenceRef as string,
    verificationStatus: value.verificationStatus as VerificationStatus,
  };
  if (
    (evidence.kind === "physical_swatch" || evidence.kind === "applied_dry") &&
    evidence.verificationStatus === "verified" &&
    (evidence.lab === null ||
      evidence.measurementProtocolId === null ||
      evidence.comparisonGroupId === null ||
      (evidence.captureProfileId === null && evidence.colorTransformRef === null))
  ) {
    return null;
  }
  if (evidence.kind === "official_color_family" && evidence.lab !== null) {
    return null;
  }
  return Object.freeze(evidence);
}

function parseCommerceRoute(
  value: unknown,
  productId: string,
  skuId: string,
): CommerceRoute | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    !ROUTE_KINDS.has(value.kind as CommerceRouteKind) ||
    !isIsoDate(value.verifiedAt) ||
    value.productId !== productId ||
    value.skuId !== skuId ||
    !nullableString(value.appId) ||
    !nullableString(value.path) ||
    !(value.url === null || isHttpsUrl(value.url)) ||
    typeof value.skuPreselectVerified !== "boolean" ||
    !nonEmptyString(value.deviceEvidenceRef)
  ) {
    return null;
  }

  const route: CommerceRoute = {
    kind: value.kind as CommerceRouteKind,
    verifiedAt: value.verifiedAt as string,
    productId: value.productId as string,
    skuId: value.skuId as string,
    appId: value.appId as string | null,
    path: value.path as string | null,
    url: value.url as string | null,
    skuPreselectVerified: value.skuPreselectVerified as boolean,
    deviceEvidenceRef: value.deviceEvidenceRef as string,
  };
  if (
    route.kind === "mini_program" &&
    (route.appId === null || route.path === null || route.url !== null)
  ) {
    return null;
  }
  if (
    route.kind === "official_web" &&
    (route.url === null || route.appId !== null || route.path !== null || route.skuPreselectVerified)
  ) {
    return null;
  }
  return Object.freeze({ ...route });
}

interface ParsedEntry {
  readonly entry: CatalogEntry;
  readonly commerceWarning: string | null;
}

function parseEntry(value: unknown, expectedCatalogVersion: string): ParsedEntry | string {
  if (!isRecord(value)) {
    return "entry must be an object";
  }
  const requiredStrings = [
    "catalogVersion",
    "brand",
    "productId",
    "skuId",
    "shadeCode",
    "shadeName",
    "name",
    "imageAsset",
  ] as const;
  if (requiredStrings.some((field) => !nonEmptyString(value[field]))) {
    return "required identity fields must be non-empty strings";
  }
  if (value.catalogVersion !== expectedCatalogVersion) {
    return "entry catalogVersion does not match the requested catalog";
  }
  if (!isHttpsUrl(value.sourceUrl) || !isIsoDate(value.verifiedAt)) {
    return "sourceUrl must use HTTPS and verifiedAt must be an ISO date";
  }
  if (!AVAILABILITIES.has(value.availability as Availability)) {
    return "availability is invalid";
  }
  const colorEvidence = parseColorEvidence(value.colorEvidence);
  if (colorEvidence === null) {
    return "colorEvidence is invalid or incomplete";
  }

  const productId = value.productId as string;
  const skuId = value.skuId as string;
  let commerceRoute: CommerceRoute | null = null;
  let commerceWarning: string | null = null;
  if (value.commerceRoute !== null) {
    commerceRoute = parseCommerceRoute(value.commerceRoute, productId, skuId);
    if (commerceRoute === null) {
      commerceWarning = "commerce route is invalid or does not match the catalog identity";
    }
  }

  const entry: CatalogEntry = {
    catalogVersion: value.catalogVersion as string,
    brand: value.brand as string,
    productId,
    skuId,
    shadeCode: value.shadeCode as string,
    shadeName: value.shadeName as string,
    name: value.name as string,
    imageAsset: value.imageAsset as string,
    sourceUrl: value.sourceUrl as string,
    verifiedAt: value.verifiedAt as string,
    availability: value.availability as Availability,
    colorEvidence,
    commerceRoute,
  };
  return { entry: Object.freeze(entry), commerceWarning };
}

export function validateCatalog(
  values: readonly unknown[],
  expectedCatalogVersion: string,
): CatalogValidationResult {
  if (!nonEmptyString(expectedCatalogVersion)) {
    throw new TypeError("expectedCatalogVersion must be a non-empty string");
  }

  const parsed = values.map((value, index) => ({ index, result: parseEntry(value, expectedCatalogVersion) }));
  const skuCounts = new Map<string, number>();
  for (const value of values) {
    if (isRecord(value) && nonEmptyString(value.skuId)) {
      skuCounts.set(value.skuId, (skuCounts.get(value.skuId) ?? 0) + 1);
    }
  }

  const entries: CatalogEntry[] = [];
  const rejected: CatalogIssue[] = [];
  const commerceWarnings: CatalogIssue[] = [];
  for (const item of parsed) {
    if (typeof item.result === "string") {
      const rawValue = values[item.index];
      const rawSku = isRecord(rawValue) ? rawValue.skuId : null;
      const mismatch = item.result.includes("catalogVersion");
      const evidence = item.result.startsWith("colorEvidence");
      rejected.push({
        index: item.index,
        skuId: nonEmptyString(rawSku) ? rawSku : null,
        code: mismatch
          ? "CATALOG_VERSION_MISMATCH"
          : evidence
            ? "INVALID_COLOR_EVIDENCE"
            : "INVALID_ENTRY",
        detail: item.result,
      });
      continue;
    }
    if ((skuCounts.get(item.result.entry.skuId) ?? 0) > 1) {
      rejected.push({
        index: item.index,
        skuId: item.result.entry.skuId,
        code: "DUPLICATE_SKU",
        detail: "duplicate SKU IDs are not admitted",
      });
      continue;
    }
    entries.push(item.result.entry);
    if (item.result.commerceWarning !== null) {
      commerceWarnings.push({
        index: item.index,
        skuId: item.result.entry.skuId,
        code: "INVALID_COMMERCE_ROUTE",
        detail: item.result.commerceWarning,
      });
    }
  }
  return { entries, rejected, commerceWarnings };
}

function sameNonEmptyValue(first: string | null, second: string | null): boolean {
  return first !== null && second !== null && first === second;
}

export function isComparableEvidence(
  capture: CaptureEvidence,
  evidence: ColorEvidence,
): boolean {
  if (
    capture.calibrationMode !== "controlled" ||
    capture.verificationStatus !== "verified" ||
    !nonEmptyString(capture.evidenceRef) ||
    evidence.verificationStatus !== "verified" ||
    (evidence.kind !== "physical_swatch" && evidence.kind !== "applied_dry") ||
    evidence.lab === null ||
    !sameNonEmptyValue(capture.measurementProtocolId, evidence.measurementProtocolId) ||
    !sameNonEmptyValue(capture.comparisonGroupId, evidence.comparisonGroupId)
  ) {
    return false;
  }
  return (
    sameNonEmptyValue(capture.captureProfileId, evidence.captureProfileId) ||
    sameNonEmptyValue(capture.colorTransformRef, evidence.colorTransformRef)
  );
}

function appliesToScope(evidence: ColorEvidence, targetScope: string): boolean {
  return evidence.applicableScopes.includes(targetScope);
}

function compareStableSku(
  first: RecommendationCandidate,
  second: RecommendationCandidate,
): number {
  if (first.entry.skuId === second.entry.skuId) {
    return 0;
  }
  return first.entry.skuId < second.entry.skuId ? -1 : 1;
}

function noCandidate(
  request: RecommendationRequest,
  reasonCodes: readonly string[],
): Recommendation {
  return {
    status: "no_candidate",
    catalogVersion: request.catalogVersion,
    sessionRevision: request.sessionRevision,
    basis: "none",
    candidates: [],
    reasonCodes,
    limitations: ["NO_VERIFIED_COMPARABLE_CANDIDATE"],
  };
}

export function recommendCatalogEntries(
  request: RecommendationRequest,
  entries: readonly CatalogEntry[],
): Recommendation {
  if (!nonEmptyString(request.catalogVersion) || !nonEmptyString(request.targetScope)) {
    throw new TypeError("catalogVersion and targetScope must be non-empty strings");
  }
  if (!Number.isInteger(request.sessionRevision) || request.sessionRevision < 0) {
    throw new RangeError("sessionRevision must be a non-negative integer");
  }
  if (!isValidLab(request.referenceLab)) {
    throw new RangeError("referenceLab is invalid");
  }

  // Treat every caller as an untrusted catalog boundary. This prevents a typed
  // but unvalidated or mutated array from bypassing duplicate/provenance rules.
  const admittedEntries = validateCatalog(entries, request.catalogVersion).entries;
  const catalogEntries = admittedEntries.filter(
    (entry) =>
      entry.catalogVersion === request.catalogVersion &&
      entry.availability === "available" &&
      appliesToScope(entry.colorEvidence, request.targetScope),
  );
  const ranked = catalogEntries
    .filter((entry) => isComparableEvidence(request.captureEvidence, entry.colorEvidence))
    .map((entry) => ({
      entry,
      distance: deltaE2000(request.referenceLab, entry.colorEvidence.lab!),
    }))
    .filter(({ distance }) => Number.isFinite(distance))
    .map<RecommendationCandidate>(({ entry, distance }) => ({
      entry,
      deltaE00: distance,
      reasonCodes: ["CLOSEST_WITHIN_VERIFIED_COMPARISON_GROUP"],
    }))
    .sort((first, second) => {
      const distanceDifference = first.deltaE00! - second.deltaE00!;
      return distanceDifference === 0 ? compareStableSku(first, second) : distanceDifference;
    })
    .slice(0, 2);

  if (ranked.length > 0) {
    return {
      status: "ranked",
      catalogVersion: request.catalogVersion,
      sessionRevision: request.sessionRevision,
      basis: "controlled_color_comparison",
      candidates: ranked,
      reasonCodes: ["VERIFIED_COMPARABLE_COLOR_EVIDENCE"],
      limitations: ["COLOR_DISTANCE_DOES_NOT_ESTABLISH_COVERAGE_PERFORMANCE"],
    };
  }

  const mapping = request.officialReferenceMapping;
  if (
    mapping !== undefined &&
    mapping.verificationStatus === "verified" &&
    nonEmptyString(mapping.evidenceRef) &&
    mapping.shadeCodes.length > 0
  ) {
    const allowedShadeCodes = new Set(mapping.shadeCodes);
    const references = catalogEntries
      .filter(
        (entry) =>
          entry.colorEvidence.kind === "official_color_family" &&
          entry.colorEvidence.verificationStatus === "verified" &&
          allowedShadeCodes.has(entry.shadeCode),
      )
      .map<RecommendationCandidate>((entry) => ({
        entry,
        deltaE00: null,
        reasonCodes: ["VERIFIED_OFFICIAL_FAMILY_MAPPING"],
      }))
      .sort(compareStableSku)
      .slice(0, 2);
    if (references.length > 0) {
      return {
        status: "reference_only",
        catalogVersion: request.catalogVersion,
        sessionRevision: request.sessionRevision,
        basis: "verified_official_family_mapping",
        candidates: references,
        reasonCodes: ["NO_COLOR_DISTANCE_RANKING"],
        limitations: ["REFERENCE_CANDIDATES_ARE_UNRANKED"],
      };
    }
  }

  const reason =
    request.captureEvidence.calibrationMode === "uncalibrated"
      ? "UNCALIBRATED_INPUT"
      : "NO_COMPARABLE_CATALOG_EVIDENCE";
  const catalogReason = entries.length === 0
    ? "CATALOG_EMPTY"
    : catalogEntries.length === 0
      ? "NO_ELIGIBLE_CATALOG_ENTRIES"
      : null;
  return noCandidate(request, catalogReason === null ? [reason] : [reason, catalogReason]);
}
