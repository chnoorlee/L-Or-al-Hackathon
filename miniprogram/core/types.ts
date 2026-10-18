export type CalibrationMode = "uncalibrated" | "controlled";

export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Center coordinates are normalized per axis; radius is relative to the image short edge. */
export interface NormalizedCircle extends Point {
  readonly radius: number;
}

export interface PixelCircle extends Point {
  readonly radius: number;
}

export interface RgbColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface RgbaColor extends RgbColor {
  readonly a: number;
}

/** XYZ values use a 0..1 scale and the D65 reference white. */
export interface XyzColor {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface LabColor {
  readonly l: number;
  readonly a: number;
  readonly b: number;
}

export interface LabDispersion {
  readonly lMad: number;
  readonly aMad: number;
  readonly bMad: number;
}

export interface PixelBuffer extends ImageSize {
  readonly data: ArrayLike<number>;
}

export type RoiQualityReason =
  | "INSUFFICIENT_VALID_PIXELS"
  | "EXPOSURE_CLIPPING";

export interface RoiColorSummary {
  readonly lab: LabColor | null;
  readonly dispersion: LabDispersion | null;
  readonly validPixelCount: number;
  readonly excludedPixelCount: number;
  readonly clippedPixelCount: number;
  readonly clippedPixelRatio: number;
  readonly qualityReasons: readonly RoiQualityReason[];
  readonly isUsable: boolean;
}

export interface ColorSummary {
  readonly conversionVersion: string;
  readonly whitePoint: "D65";
  readonly calibrationMode: CalibrationMode;
  readonly cover: RoiColorSummary;
  readonly reference: RoiColorSummary;
}

export type ColorEvidenceKind =
  | "physical_swatch"
  | "applied_dry"
  | "official_color_family"
  | "web_display";

export type VerificationStatus = "verified" | "unverified";

export interface ColorEvidence {
  readonly kind: ColorEvidenceKind;
  readonly measurementProtocolId: string | null;
  readonly comparisonGroupId: string | null;
  readonly captureProfileId: string | null;
  readonly colorTransformRef: string | null;
  readonly lab: LabColor | null;
  readonly applicableScopes: readonly string[];
  readonly evidenceRef: string;
  readonly verificationStatus: VerificationStatus;
}

export type Availability = "available" | "unavailable" | "unknown";

export type CommerceRouteKind = "mini_program" | "official_web";

export interface CommerceRoute {
  readonly kind: CommerceRouteKind;
  readonly verifiedAt: string;
  readonly productId: string;
  readonly skuId: string;
  readonly appId: string | null;
  readonly path: string | null;
  readonly url: string | null;
  readonly skuPreselectVerified: boolean;
  readonly deviceEvidenceRef: string;
}

export interface CatalogEntry {
  readonly catalogVersion: string;
  readonly brand: string;
  readonly productId: string;
  readonly skuId: string;
  readonly shadeCode: string;
  readonly shadeName: string;
  readonly name: string;
  readonly imageAsset: string;
  readonly sourceUrl: string;
  readonly verifiedAt: string;
  readonly availability: Availability;
  readonly colorEvidence: ColorEvidence;
  /** Invalid or unverified commerce data is normalized to null without hiding valid color evidence. */
  readonly commerceRoute: CommerceRoute | null;
}

export interface CaptureEvidence {
  readonly calibrationMode: CalibrationMode;
  readonly measurementProtocolId: string | null;
  readonly comparisonGroupId: string | null;
  readonly captureProfileId: string | null;
  readonly colorTransformRef: string | null;
  readonly evidenceRef: string | null;
  readonly verificationStatus: VerificationStatus;
}

export interface OfficialReferenceMapping {
  readonly verificationStatus: "verified";
  readonly evidenceRef: string;
  readonly shadeCodes: readonly string[];
}

export interface RecommendationRequest {
  readonly catalogVersion: string;
  readonly sessionRevision: number;
  readonly referenceLab: LabColor;
  readonly targetScope: string;
  readonly captureEvidence: CaptureEvidence;
  readonly officialReferenceMapping?: OfficialReferenceMapping;
}

export type RecommendationStatus =
  | "ranked"
  | "reference_only"
  | "no_candidate";

export type RecommendationBasis =
  | "controlled_color_comparison"
  | "verified_official_family_mapping"
  | "none";

export interface RecommendationCandidate {
  readonly entry: CatalogEntry;
  /** Internal evidence only; UI must not turn this into a match percentage. */
  readonly deltaE00: number | null;
  readonly reasonCodes: readonly string[];
}

export interface Recommendation {
  readonly status: RecommendationStatus;
  readonly catalogVersion: string;
  readonly sessionRevision: number;
  readonly basis: RecommendationBasis;
  readonly candidates: readonly RecommendationCandidate[];
  readonly reasonCodes: readonly string[];
  readonly limitations: readonly string[];
}
