import type {
  AnalysisImagePlan,
  CanvasTransform,
  ChosenImage,
  ImageOrientation,
} from "./types";

interface OrientationGeometry {
  readonly swapsAxes: boolean;
  readonly transform: CanvasTransform;
}

export function createAnalysisImagePlan(
  image: Pick<ChosenImage, "width" | "height" | "orientation">,
  maxLongEdge: number,
): AnalysisImagePlan {
  assertPositiveDimension(image.width, "image.width");
  assertPositiveDimension(image.height, "image.height");
  if (!Number.isInteger(maxLongEdge) || maxLongEdge <= 0) {
    throw new RangeError("maxLongEdge must be a positive integer");
  }

  const geometry = orientationGeometry(
    image.orientation,
    image.width,
    image.height,
  );
  const orientedWidth = geometry.swapsAxes ? image.height : image.width;
  const orientedHeight = geometry.swapsAxes ? image.width : image.height;
  const output = containSize(orientedWidth, orientedHeight, maxLongEdge);
  const scaleX = output.width / orientedWidth;
  const scaleY = output.height / orientedHeight;
  const transform = geometry.transform;

  return Object.freeze({
    sourceWidth: image.width,
    sourceHeight: image.height,
    sourceOrientation: image.orientation,
    orientationKnown: image.orientation !== "unknown",
    orientedWidth,
    orientedHeight,
    width: output.width,
    height: output.height,
    transform: Object.freeze({
      a: transform.a * scaleX,
      b: transform.b * scaleY,
      c: transform.c * scaleX,
      d: transform.d * scaleY,
      e: transform.e * scaleX,
      f: transform.f * scaleY,
    }),
  });
}

function orientationGeometry(
  orientation: ImageOrientation,
  width: number,
  height: number,
): OrientationGeometry {
  switch (orientation) {
    case "up-mirrored":
      return geometry(false, -1, 0, 0, 1, width, 0);
    case "down":
      return geometry(false, -1, 0, 0, -1, width, height);
    case "down-mirrored":
      return geometry(false, 1, 0, 0, -1, 0, height);
    case "left-mirrored":
      return geometry(true, 0, 1, 1, 0, 0, 0);
    case "right":
      return geometry(true, 0, 1, -1, 0, height, 0);
    case "right-mirrored":
      return geometry(true, 0, -1, -1, 0, height, width);
    case "left":
      return geometry(true, 0, -1, 1, 0, 0, width);
    case "unknown":
    case "up":
      return geometry(false, 1, 0, 0, 1, 0, 0);
  }
}

function geometry(
  swapsAxes: boolean,
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  f: number,
): OrientationGeometry {
  return { swapsAxes, transform: { a, b, c, d, e, f } };
}

function containSize(
  width: number,
  height: number,
  maxLongEdge: number,
): { readonly width: number; readonly height: number } {
  if (Math.max(width, height) <= maxLongEdge) {
    return { width, height };
  }
  if (width >= height) {
    return {
      width: maxLongEdge,
      height: Math.max(1, Math.round((height * maxLongEdge) / width)),
    };
  }
  return {
    width: Math.max(1, Math.round((width * maxLongEdge) / height)),
    height: maxLongEdge,
  };
}

function assertPositiveDimension(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
}
