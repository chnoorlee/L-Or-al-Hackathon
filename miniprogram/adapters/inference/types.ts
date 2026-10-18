import type { AnalysisCancellationSignal } from "../../session/index";

export type InferenceOutcome<TSuggestion> =
  | { readonly kind: "suggestion"; readonly suggestion: TSuggestion }
  | {
      readonly kind: "unavailable";
      readonly reason: "not_configured" | "unsupported";
    }
  | { readonly kind: "empty" }
  | { readonly kind: "failed"; readonly retryable: boolean };

export interface InferenceAdapter<TImage = unknown, TSuggestion = unknown> {
  suggest(
    image: TImage,
    signal?: AnalysisCancellationSignal,
  ): Promise<InferenceOutcome<TSuggestion>>;
  dispose(): void | Promise<void>;
}

