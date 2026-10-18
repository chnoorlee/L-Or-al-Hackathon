import type { LabColor, RgbColor, XyzColor } from "./types";

/**
 * Identifies the exact conversion implemented below: IEC sRGB inverse transfer,
 * the 7-decimal linear-sRGB-to-XYZ D65 matrix, and CIE 1976 Lab with the
 * (0.95047, 1, 1.08883) D65 reference white, with sRGB lightness clamped to
 * [0, 100] for matrix-rounding drift. Bump this when any constant or
 * processing step changes.
 */
export const COLOR_CONVERSION_VERSION = "srgb-d65-cielab-v2";

export const D65_REFERENCE_WHITE: Readonly<XyzColor> = Object.freeze({
  x: 0.95047,
  y: 1,
  z: 1.08883,
});

// The MVP accepts a deliberately broad, finite CIELAB evidence domain. Values
// outside this range cannot come from the sRGB conversion above and are more
// likely to be malformed input than meaningful product-color evidence.
const MAX_SUPPORTED_LAB_CHROMA_COMPONENT = 200;

function requireRgbChannel(channel: number, name: string): void {
  if (!Number.isFinite(channel) || channel < 0 || channel > 255) {
    throw new RangeError(`${name} must be finite and between 0 and 255`);
  }
}

export function srgbChannelToLinear(channel: number): number {
  requireRgbChannel(channel, "sRGB channel");
  const normalized = channel / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

export function srgbToXyzD65(rgb: RgbColor): XyzColor {
  requireRgbChannel(rgb.r, "red");
  requireRgbChannel(rgb.g, "green");
  requireRgbChannel(rgb.b, "blue");

  const r = srgbChannelToLinear(rgb.r);
  const g = srgbChannelToLinear(rgb.g);
  const b = srgbChannelToLinear(rgb.b);

  return {
    x: 0.4124564 * r + 0.3575761 * g + 0.1804375 * b,
    y: 0.2126729 * r + 0.7151522 * g + 0.072175 * b,
    z: 0.0193339 * r + 0.119192 * g + 0.9503041 * b,
  };
}

function labTransfer(value: number): number {
  const epsilon = 216 / 24_389;
  const kappa = 24_389 / 27;
  return value > epsilon ? Math.cbrt(value) : (kappa * value + 16) / 116;
}

export function xyzD65ToLab(xyz: XyzColor): LabColor {
  if (![xyz.x, xyz.y, xyz.z].every(Number.isFinite)) {
    throw new TypeError("XYZ components must be finite");
  }
  if (xyz.x < 0 || xyz.y < 0 || xyz.z < 0) {
    throw new RangeError("XYZ components must be non-negative");
  }

  const fx = labTransfer(xyz.x / D65_REFERENCE_WHITE.x);
  const fy = labTransfer(xyz.y / D65_REFERENCE_WHITE.y);
  const fz = labTransfer(xyz.z / D65_REFERENCE_WHITE.z);
  return {
    l: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

export function srgbToLab(rgb: RgbColor): LabColor {
  const lab = xyzD65ToLab(srgbToXyzD65(rgb));
  // Rounded matrix coefficients sum to Y=1.0000001 for white. Valid sRGB
  // cannot exceed L*=100; keep its tiny drift out of downstream validation.
  return { ...lab, l: Math.max(0, Math.min(100, lab.l)) };
}

export function isValidLab(lab: unknown): lab is LabColor {
  if (typeof lab !== "object" || lab === null) {
    return false;
  }
  const candidate = lab as Record<string, unknown>;
  return (
    typeof candidate.l === "number" &&
    Number.isFinite(candidate.l) &&
    candidate.l >= 0 &&
    candidate.l <= 100 &&
    typeof candidate.a === "number" &&
    Number.isFinite(candidate.a) &&
    Math.abs(candidate.a) <= MAX_SUPPORTED_LAB_CHROMA_COMPONENT &&
    typeof candidate.b === "number" &&
    Number.isFinite(candidate.b) &&
    Math.abs(candidate.b) <= MAX_SUPPORTED_LAB_CHROMA_COMPONENT
  );
}
