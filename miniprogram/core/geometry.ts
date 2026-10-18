import type {
  ImageSize,
  NormalizedCircle,
  PixelCircle,
  Point,
} from "./types";

export type CircleIssue =
  | "NON_FINITE"
  | "NON_POSITIVE_RADIUS"
  | "OUT_OF_BOUNDS";

export type SamplePairIssue =
  | "INVALID_IMAGE_SIZE"
  | "INVALID_COVER_CIRCLE"
  | "INVALID_REFERENCE_CIRCLE"
  | "OVERLAPPING_CIRCLES";

export interface ContainTransform {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly displayedWidth: number;
  readonly displayedHeight: number;
}

export function isValidImageSize(size: ImageSize): boolean {
  return (
    Number.isInteger(size.width) &&
    Number.isInteger(size.height) &&
    size.width > 0 &&
    size.height > 0
  );
}

function requireImageSize(size: ImageSize): void {
  if (!isValidImageSize(size)) {
    throw new RangeError("image dimensions must be positive integers");
  }
}

export function getCircleIssues(
  circle: NormalizedCircle,
  size: ImageSize,
): readonly CircleIssue[] {
  if (![circle.x, circle.y, circle.radius].every(Number.isFinite)) {
    return ["NON_FINITE"];
  }
  if (circle.radius <= 0) {
    return ["NON_POSITIVE_RADIUS"];
  }
  if (!isValidImageSize(size)) {
    return ["OUT_OF_BOUNDS"];
  }

  const pixelCircle = circleToPixels(circle, size);
  const outside =
    pixelCircle.x - pixelCircle.radius < 0 ||
    pixelCircle.y - pixelCircle.radius < 0 ||
    pixelCircle.x + pixelCircle.radius > size.width ||
    pixelCircle.y + pixelCircle.radius > size.height;

  return outside ? ["OUT_OF_BOUNDS"] : [];
}

export function circleToPixels(
  circle: NormalizedCircle,
  size: ImageSize,
): PixelCircle {
  requireImageSize(size);
  return {
    x: circle.x * size.width,
    y: circle.y * size.height,
    radius: circle.radius * Math.min(size.width, size.height),
  };
}

export function circlesOverlap(
  first: NormalizedCircle,
  second: NormalizedCircle,
  size: ImageSize,
): boolean {
  const a = circleToPixels(first, size);
  const b = circleToPixels(second, size);
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const radiusSum = a.radius + b.radius;
  return dx * dx + dy * dy < radiusSum * radiusSum;
}

export function getSamplePairIssues(
  coverCircle: NormalizedCircle,
  referenceCircle: NormalizedCircle,
  size: ImageSize,
): readonly SamplePairIssue[] {
  if (!isValidImageSize(size)) {
    return ["INVALID_IMAGE_SIZE"];
  }

  const issues: SamplePairIssue[] = [];
  if (getCircleIssues(coverCircle, size).length > 0) {
    issues.push("INVALID_COVER_CIRCLE");
  }
  if (getCircleIssues(referenceCircle, size).length > 0) {
    issues.push("INVALID_REFERENCE_CIRCLE");
  }
  if (issues.length === 0 && circlesOverlap(coverCircle, referenceCircle, size)) {
    issues.push("OVERLAPPING_CIRCLES");
  }
  return issues;
}

export function createContainTransform(
  image: ImageSize,
  viewport: ImageSize,
): ContainTransform {
  requireImageSize(image);
  requireImageSize(viewport);

  const scale = Math.min(viewport.width / image.width, viewport.height / image.height);
  const displayedWidth = image.width * scale;
  const displayedHeight = image.height * scale;
  return {
    scale,
    displayedWidth,
    displayedHeight,
    offsetX: (viewport.width - displayedWidth) / 2,
    offsetY: (viewport.height - displayedHeight) / 2,
  };
}

export function normalizedPointToViewport(
  point: Point,
  image: ImageSize,
  transform: ContainTransform,
): Point {
  if (![point.x, point.y].every(Number.isFinite)) {
    throw new TypeError("point coordinates must be finite");
  }
  requireImageSize(image);
  return {
    x: transform.offsetX + point.x * image.width * transform.scale,
    y: transform.offsetY + point.y * image.height * transform.scale,
  };
}

export function viewportPointToNormalized(
  point: Point,
  image: ImageSize,
  transform: ContainTransform,
): Point | null {
  if (![point.x, point.y].every(Number.isFinite)) {
    return null;
  }
  requireImageSize(image);
  const x = (point.x - transform.offsetX) / (image.width * transform.scale);
  const y = (point.y - transform.offsetY) / (image.height * transform.scale);
  if (x < 0 || x > 1 || y < 0 || y > 1) {
    return null;
  }
  return { x, y };
}
