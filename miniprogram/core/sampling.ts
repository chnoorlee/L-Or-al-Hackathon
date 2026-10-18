import { srgbToLab } from "./color";
import { circleToPixels, getCircleIssues, isValidImageSize } from "./geometry";
import type {
  LabColor,
  LabDispersion,
  NormalizedCircle,
  PixelBuffer,
  RoiColorSummary,
  RoiQualityReason,
} from "./types";

export function median(values: readonly number[]): number {
  if (values.length === 0) {
    throw new RangeError("median requires at least one value");
  }
  if (!values.every(Number.isFinite)) {
    throw new TypeError("median values must be finite");
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function medianAbsoluteDeviation(
  values: readonly number[],
  center = median(values),
): number {
  if (!Number.isFinite(center)) {
    throw new TypeError("MAD center must be finite");
  }
  return median(values.map((value) => Math.abs(value - center)));
}

export function summarizeLabColors(colors: readonly LabColor[]): {
  readonly lab: LabColor;
  readonly dispersion: LabDispersion;
} {
  if (colors.length === 0) {
    throw new RangeError("at least one Lab color is required");
  }

  const lValues = colors.map((color) => color.l);
  const aValues = colors.map((color) => color.a);
  const bValues = colors.map((color) => color.b);
  const lab: LabColor = {
    l: median(lValues),
    a: median(aValues),
    b: median(bValues),
  };
  return {
    lab,
    dispersion: {
      lMad: medianAbsoluteDeviation(lValues, lab.l),
      aMad: medianAbsoluteDeviation(aValues, lab.a),
      bMad: medianAbsoluteDeviation(bValues, lab.b),
    },
  };
}

function isByte(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 255;
}

export interface SamplingOptions {
  readonly minValidPixels: number;
  readonly clippedPixelRatioWarn: number;
}

export function sampleCircularRoi(
  image: PixelBuffer,
  circle: NormalizedCircle,
  options: SamplingOptions,
): RoiColorSummary {
  if (!isValidImageSize(image)) {
    throw new RangeError("image dimensions must be positive integers");
  }
  const expectedLength = image.width * image.height * 4;
  if (image.data.length !== expectedLength) {
    throw new RangeError(`pixel buffer length must be ${expectedLength}`);
  }
  if (getCircleIssues(circle, image).length > 0) {
    throw new RangeError("sample circle must be finite, positive, and inside the image");
  }
  if (!Number.isInteger(options.minValidPixels) || options.minValidPixels <= 0) {
    throw new RangeError("minValidPixels must be a positive integer");
  }
  if (
    !Number.isFinite(options.clippedPixelRatioWarn) ||
    options.clippedPixelRatioWarn < 0 ||
    options.clippedPixelRatioWarn > 1
  ) {
    throw new RangeError("clippedPixelRatioWarn must be between 0 and 1");
  }

  const pixelCircle = circleToPixels(circle, image);
  const minX = Math.max(0, Math.ceil(pixelCircle.x - pixelCircle.radius - 0.5));
  const maxX = Math.min(
    image.width - 1,
    Math.floor(pixelCircle.x + pixelCircle.radius - 0.5),
  );
  const minY = Math.max(0, Math.ceil(pixelCircle.y - pixelCircle.radius - 0.5));
  const maxY = Math.min(
    image.height - 1,
    Math.floor(pixelCircle.y + pixelCircle.radius - 0.5),
  );
  const radiusSquared = pixelCircle.radius * pixelCircle.radius;
  const maximumPixelCount = (maxX - minX + 1) * (maxY - minY + 1);
  const lValues = new Float64Array(maximumPixelCount);
  const aValues = new Float64Array(maximumPixelCount);
  const bValues = new Float64Array(maximumPixelCount);
  let validPixelCount = 0;
  let excludedPixelCount = 0;
  let clippedPixelCount = 0;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x + 0.5 - pixelCircle.x;
      const dy = y + 0.5 - pixelCircle.y;
      if (dx * dx + dy * dy > radiusSquared) {
        continue;
      }

      const offset = (y * image.width + x) * 4;
      const r = image.data[offset];
      const g = image.data[offset + 1];
      const b = image.data[offset + 2];
      const alpha = image.data[offset + 3];
      if (![r, g, b, alpha].every(isByte) || alpha !== 255) {
        excludedPixelCount += 1;
        continue;
      }
      if (r === 0 || r === 255 || g === 0 || g === 255 || b === 0 || b === 255) {
        clippedPixelCount += 1;
      }
      const lab = srgbToLab({ r, g, b });
      lValues[validPixelCount] = lab.l;
      aValues[validPixelCount] = lab.a;
      bValues[validPixelCount] = lab.b;
      validPixelCount += 1;
    }
  }

  const clippedPixelRatio =
    validPixelCount === 0 ? 0 : clippedPixelCount / validPixelCount;
  const qualityReasons: RoiQualityReason[] = [];
  if (validPixelCount < options.minValidPixels) {
    qualityReasons.push("INSUFFICIENT_VALID_PIXELS");
  }
  if (
    validPixelCount > 0 &&
    clippedPixelRatio >= options.clippedPixelRatioWarn
  ) {
    qualityReasons.push("EXPOSURE_CLIPPING");
  }

  const summary = validPixelCount === 0
    ? null
    : summarizeLabChannels(lValues, aValues, bValues, validPixelCount);
  return {
    lab: summary?.lab ?? null,
    dispersion: summary?.dispersion ?? null,
    validPixelCount,
    excludedPixelCount,
    clippedPixelCount,
    clippedPixelRatio,
    qualityReasons,
    isUsable: validPixelCount >= options.minValidPixels,
  };
}

function summarizeLabChannels(
  lValues: Float64Array,
  aValues: Float64Array,
  bValues: Float64Array,
  length: number,
): { readonly lab: LabColor; readonly dispersion: LabDispersion } {
  const lab: LabColor = {
    l: typedMedian(lValues, length),
    a: typedMedian(aValues, length),
    b: typedMedian(bValues, length),
  };
  return {
    lab,
    dispersion: {
      lMad: typedMedianAbsoluteDeviation(lValues, length, lab.l),
      aMad: typedMedianAbsoluteDeviation(aValues, length, lab.a),
      bMad: typedMedianAbsoluteDeviation(bValues, length, lab.b),
    },
  };
}

function typedMedian(values: Float64Array, length: number): number {
  const active = values.subarray(0, length);
  active.sort();
  const middle = Math.floor(length / 2);
  return length % 2 === 0
    ? (active[middle - 1] + active[middle]) / 2
    : active[middle];
}

function typedMedianAbsoluteDeviation(
  values: Float64Array,
  length: number,
  center: number,
): number {
  for (let index = 0; index < length; index += 1) {
    values[index] = Math.abs(values[index] - center);
  }
  return typedMedian(values, length);
}
