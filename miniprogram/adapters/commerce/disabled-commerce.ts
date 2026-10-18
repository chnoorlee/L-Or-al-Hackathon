import type { CommerceRoute } from "../../core/index";
import type {
  CommerceAdapter,
  CommerceOpenOutcome,
} from "./types";

export class DisabledCommerceAdapter implements CommerceAdapter {
  async openFromUserGesture(
    _route: CommerceRoute,
  ): Promise<CommerceOpenOutcome> {
    return { kind: "unavailable", reason: "not_configured" };
  }
}

