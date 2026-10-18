import type { CommerceRoute } from "../../core/index";

export type VerifiedMiniProgramRoute = CommerceRoute & {
  readonly kind: "mini_program";
  readonly appId: string;
  readonly path: string;
  readonly url: null;
};

export type CommerceOpenOutcome =
  | { readonly kind: "opened" }
  | { readonly kind: "cancelled" }
  | {
      readonly kind: "unavailable";
      readonly reason: "not_configured" | "api_unavailable";
    }
  | {
      readonly kind: "failed";
      readonly reason: "invalid_verified_route" | "navigation_failed";
    };

export interface CommerceAdapter {
  openFromUserGesture(route: CommerceRoute): Promise<CommerceOpenOutcome>;
}

export interface WeChatCommerceApi {
  navigateToMiniProgram(options: {
    readonly appId: string;
    readonly path?: string;
    readonly success: () => void;
    readonly fail: (error: { readonly errMsg?: string }) => void;
  }): void;
}

