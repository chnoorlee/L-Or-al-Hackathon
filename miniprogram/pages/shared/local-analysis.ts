import {
  DEFAULT_CORE_CONFIG,
  COLOR_CONVERSION_VERSION,
  circleToPixels,
  getCircleIssues,
  getSamplePairIssues,
  median,
  recommendCatalogEntries,
  sampleCircularRoi,
  type NormalizedCircle,
  type ColorSummary,
  type RoiColorSummary,
} from "../../core/index";
import {
  appAnalysisCoordinator,
  appSessionStore,
  type AnalysisResult,
  type AppSessionImage,
  type SamplePair,
  type SessionImageIdentity,
} from "../../session/index";
import {
  PRODUCTION_CATALOG,
} from "../../data/catalog.production";

export interface SampleInspection {
  readonly confirmed: boolean;
  readonly message: string | null;
  readonly warning: string | null;
  readonly coverColor: string | null;
  readonly referenceColor: string | null;
  readonly coverSummary: RoiColorSummary | null;
  readonly referenceSummary: RoiColorSummary | null;
}

export function inspectSample(
  image: AppSessionImage,
  sample: Pick<SamplePair, "coverCircle" | "referenceCircle">,
): SampleInspection {
  if (image.analysis === null) {
    return emptyInspection("图片尚未准备完成，请重新选择。");
  }
  if (sample.coverCircle === null) {
    return emptyInspection("请先在图片上选择 A 待遮盖处。");
  }
  if (sample.referenceCircle === null) {
    return {
      ...emptyInspection("请再选择 B 希望接近的周边肤色。"),
      coverColor: previewCircle(image.analysis, sample.coverCircle),
    };
  }

  const pairIssues = getSamplePairIssues(
    sample.coverCircle,
    sample.referenceCircle,
    image.analysis,
  );
  if (pairIssues.includes("OVERLAPPING_CIRCLES")) {
    return {
      ...emptyInspection("A、B 取样范围不能重叠，请移动其中一处。"),
      coverColor: previewCircle(image.analysis, sample.coverCircle),
      referenceColor: previewCircle(image.analysis, sample.referenceCircle),
    };
  }
  if (pairIssues.includes("INVALID_COVER_CIRCLE")) {
    return emptyInspection("A 取样范围超出图片，请向内移动或缩小。");
  }
  if (pairIssues.includes("INVALID_REFERENCE_CIRCLE")) {
    return emptyInspection("B 取样范围超出图片，请向内移动或缩小。");
  }

  const coverSummary = summarize(image, sample.coverCircle);
  const referenceSummary = summarize(image, sample.referenceCircle);
  const coverColor = previewCircle(image.analysis, sample.coverCircle);
  const referenceColor = previewCircle(image.analysis, sample.referenceCircle);
  if (coverSummary?.isUsable !== true) {
    return {
      ...emptyInspection("A 区有效像素不足，请扩大范围或移动位置。"),
      coverSummary,
      referenceSummary,
      coverColor,
      referenceColor,
    };
  }
  if (referenceSummary?.isUsable !== true) {
    return {
      ...emptyInspection("B 区有效像素不足，请扩大范围或移动位置。"),
      coverSummary,
      referenceSummary,
      coverColor,
      referenceColor,
    };
  }

  const coverClipped = coverSummary.qualityReasons.includes("EXPOSURE_CLIPPING");
  const referenceClipped = referenceSummary.qualityReasons.includes("EXPOSURE_CLIPPING");
  let warning: string | null = null;
  if (coverClipped || referenceClipped) {
    const regions = coverClipped && referenceClipped
      ? "A、B 区"
      : coverClipped
        ? "A 区"
        : "B 区";
    warning = `${regions}可能存在过曝或欠曝，建议移动取样或重新拍摄；仍可继续查看参考。`;
  }

  return {
    confirmed: true,
    message: null,
    warning,
    coverColor,
    referenceColor,
    coverSummary,
    referenceSummary,
  };
}

export async function runLocalAnalysis(identity: SessionImageIdentity) {
  return appAnalysisCoordinator.run(async (context): Promise<AnalysisResult> => {
    const snapshot = appSessionStore.getSnapshot();
    const image = snapshot.image;
    const sample = snapshot.sample;
    if (
      image === null ||
      image.analysis === null ||
      sample === null ||
      sample.coverCircle === null ||
      sample.referenceCircle === null
    ) {
      throw new Error("Missing fixed analysis image or sample pair");
    }

    context.signal.throwIfCancelled();
    const geometryIssues = getSamplePairIssues(
      sample.coverCircle,
      sample.referenceCircle,
      image.analysis,
    );
    if (geometryIssues.length > 0) {
      throw new Error("Invalid sample geometry");
    }

    await nextUiTurn();
    context.signal.throwIfCancelled();
    context.setStage("extracting_color");
    const inspection = inspectSample(image, sample);
    if (
      !inspection.confirmed ||
      inspection.coverSummary === null ||
      inspection.coverSummary.lab === null ||
      inspection.referenceSummary?.lab === null ||
      inspection.referenceSummary === null ||
      inspection.coverColor === null ||
      inspection.referenceColor === null
    ) {
      throw new Error("Sample pixels are not usable");
    }

    await nextUiTurn();
    context.signal.throwIfCancelled();
    context.setStage("finding_candidates");
    const recommendation = recommendCatalogEntries(
      {
        catalogVersion: snapshot.catalogVersion,
        sessionRevision: snapshot.revision,
        referenceLab: inspection.referenceSummary.lab,
        targetScope: "concealer",
        captureEvidence: image.captureEvidence,
      },
      PRODUCTION_CATALOG,
    );
    context.signal.throwIfCancelled();
    const colorSummary: ColorSummary = {
      conversionVersion: COLOR_CONVERSION_VERSION,
      whitePoint: "D65",
      calibrationMode: image.captureEvidence.calibrationMode,
      cover: inspection.coverSummary,
      reference: inspection.referenceSummary,
    };
    return {
      recommendation,
      colorSummary,
      previewColors: {
        cover: inspection.coverColor,
        reference: inspection.referenceColor,
      },
    };
  }, identity);
}

function summarize(
  image: AppSessionImage,
  circle: NormalizedCircle,
): RoiColorSummary | null {
  if (image.analysis === null || getCircleIssues(circle, image.analysis).length > 0) {
    return null;
  }
  return sampleCircularRoi(image.analysis, circle, {
    minValidPixels: DEFAULT_CORE_CONFIG.minValidPixelsPerRoi,
    clippedPixelRatioWarn: DEFAULT_CORE_CONFIG.clippedPixelRatioWarn,
  });
}

function previewCircle(
  image: NonNullable<AppSessionImage["analysis"]>,
  circle: NormalizedCircle,
): string | null {
  if (getCircleIssues(circle, image).length > 0) {
    return null;
  }
  const pixelCircle = circleToPixels(circle, image);
  const minX = Math.max(0, Math.ceil(pixelCircle.x - pixelCircle.radius - 0.5));
  const maxX = Math.min(image.width - 1, Math.floor(pixelCircle.x + pixelCircle.radius - 0.5));
  const minY = Math.max(0, Math.ceil(pixelCircle.y - pixelCircle.radius - 0.5));
  const maxY = Math.min(image.height - 1, Math.floor(pixelCircle.y + pixelCircle.radius - 0.5));
  const radiusSquared = pixelCircle.radius * pixelCircle.radius;
  const channels: [number[], number[], number[]] = [[], [], []];

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x + 0.5 - pixelCircle.x;
      const dy = y + 0.5 - pixelCircle.y;
      if (dx * dx + dy * dy > radiusSquared) {
        continue;
      }
      const offset = (y * image.width + x) * 4;
      if (image.data[offset + 3] !== 255) {
        continue;
      }
      channels[0].push(image.data[offset]);
      channels[1].push(image.data[offset + 1]);
      channels[2].push(image.data[offset + 2]);
    }
  }
  if (channels[0].length === 0) {
    return null;
  }
  return `#${channels
    .map((values) => Math.round(median(values)).toString(16).padStart(2, "0"))
    .join("")}`;
}

function emptyInspection(message: string): SampleInspection {
  return {
    confirmed: false,
    message,
    warning: null,
    coverColor: null,
    referenceColor: null,
    coverSummary: null,
    referenceSummary: null,
  };
}

function nextUiTurn(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
