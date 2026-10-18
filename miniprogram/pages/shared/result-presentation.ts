import { circleToPixels, type ImageSize, type NormalizedCircle, type Recommendation, type ColorSummary } from "../../core/index";

export function presentRecommendation(recommendation: Recommendation) {
  if (recommendation.status === "ranked") {
    return {
      title: "色号参考",
      conclusion: `基于同一已验证颜色协议，为你缩小到 ${recommendation.candidates.length} 个试色候选。`,
      emptyTitle: "",
      emptyCopy: "",
    };
  }
  if (recommendation.status === "reference_only") {
    return {
      title: "色系参考",
      conclusion: `找到 ${recommendation.candidates.length} 个已核验的参考候选；这些候选不分先后。`,
      emptyTitle: "",
      emptyCopy: "",
    };
  }
  const reasons = recommendation.reasonCodes;
  const explanation = reasons.includes("CATALOG_EMPTY")
    ? {
        emptyTitle: "商品色号尚未接入",
        emptyCopy: "本次已完成照片取色。当前还没有可用的商品色号，重拍或调整取样不会补齐商品数据；无需为此反复尝试。",
      }
    : reasons.includes("NO_ELIGIBLE_CATALOG_ENTRIES")
      ? {
          emptyTitle: "暂没有适用于本次取样的商品",
          emptyCopy: "当前商品资料尚不能支持本次参考。调整取样无法补齐商品资料或改变商品可用状态，可先完成本次取色。",
        }
      : reasons.includes("UNCALIBRATED_INPUT")
        ? {
            emptyTitle: "这张照片暂不能对应到商品色号",
            emptyCopy: "普通照片受光线和设备影响，尚无经过验证的选色依据。仅重拍或移动圆框，不能保证获得色号；两处颜色可用于核对取样位置。",
          }
        : {
            emptyTitle: "尚无可靠的色号参考",
            emptyCopy: "现有商品与本次照片之间缺少可比依据。可以核对 A、B 取样位置，或完成本次取色；不需要反复重试。",
          };
  return {
    title: "本次取样",
    conclusion: "两处颜色已提取，B 是你选择的目标参考色。",
    ...explanation,
  };
}

export function qualityNotice(summary: ColorSummary): string {
  const regions = [
    summary.cover.qualityReasons.includes("EXPOSURE_CLIPPING") ? "A" : "",
    summary.reference.qualityReasons.includes("EXPOSURE_CLIPPING") ? "B" : "",
  ].filter(Boolean).join("、");
  return regions
    ? `${regions} 区可能存在过曝或欠曝，颜色参考可能受影响。若看到反光或阴影，可返回调整取样。`
    : "";
}

/** Percentages share the fixed image's aspect ratio; radii use its short edge. */
export function resultMarkerStyle(circle: NormalizedCircle, image: ImageSize): string {
  const pixels = circleToPixels(circle, image);
  return [
    `left:${circle.x * 100}%`,
    `top:${circle.y * 100}%`,
    `width:${pixels.radius * 2 / image.width * 100}%`,
    `height:${pixels.radius * 2 / image.height * 100}%`,
  ].join(";");
}
