import type { AnalysisCancellationSignal } from "../../session/index";
import type { InferenceAdapter, InferenceOutcome } from "./types";

export class NullInferenceAdapter<TImage = unknown, TSuggestion = never>
  implements InferenceAdapter<TImage, TSuggestion>
{
  async suggest(
    _image: TImage,
    _signal?: AnalysisCancellationSignal,
  ): Promise<InferenceOutcome<TSuggestion>> {
    return { kind: "unavailable", reason: "not_configured" };
  }

  dispose(): void {
    // This adapter owns no model session or buffers.
  }
}

