import type { CommerceRoute } from "../../core/index";
import type {
  CommerceAdapter,
  CommerceOpenOutcome,
  VerifiedMiniProgramRoute,
  WeChatCommerceApi,
} from "./types";

export class VerifiedWeChatCommerceAdapter implements CommerceAdapter {
  constructor(private readonly api: WeChatCommerceApi | null) {}

  async openFromUserGesture(
    route: CommerceRoute,
  ): Promise<CommerceOpenOutcome> {
    if (!isCompleteVerifiedRoute(route)) {
      return { kind: "failed", reason: "invalid_verified_route" };
    }
    if (this.api === null) {
      return { kind: "unavailable", reason: "api_unavailable" };
    }

    const api = this.api;
    return new Promise((resolve) => {
      try {
        api.navigateToMiniProgram({
          appId: route.appId,
          path: route.path,
          success: () => resolve({ kind: "opened" }),
          fail: (error) => {
            const cancelled =
              error.errMsg?.toLowerCase().includes("cancel") ?? false;
            resolve(
              cancelled
                ? { kind: "cancelled" }
                : { kind: "failed", reason: "navigation_failed" },
            );
          },
        });
      } catch {
        resolve({ kind: "failed", reason: "navigation_failed" });
      }
    });
  }
}

export const appCommerceAdapter = new VerifiedWeChatCommerceAdapter(
  typeof wx === "undefined" ? null : wx,
);

function isCompleteVerifiedRoute(
  route: CommerceRoute,
): route is VerifiedMiniProgramRoute {
  return (
    route.kind === "mini_program" &&
    route.appId !== null &&
    route.appId.trim().length > 0 &&
    route.path !== null &&
    route.path.trim().length > 0 &&
    route.url === null &&
    route.productId.trim().length > 0 &&
    route.skuId.trim().length > 0 &&
    isIsoDate(route.verifiedAt) &&
    route.deviceEvidenceRef.trim().length > 0
  );
}

function isIsoDate(value: string): boolean {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z)?$/.exec(
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

