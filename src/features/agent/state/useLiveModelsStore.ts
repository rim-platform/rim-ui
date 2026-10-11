import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { AiModelDef } from "../providers/types";

interface LiveModelsState {
  /** The last non-empty model list fetched from each provider's API, by provider id. */
  byProvider: Record<string, AiModelDef[]>;
  setModels: (providerId: string, models: AiModelDef[]) => void;
}

/** The providers' live model lists, shared by the settings panel, the overlay and the engine. */
export const useLiveModelsStore = create<LiveModelsState>()(
  persist(
    (set) => ({
      byProvider: {},
      setModels: (providerId, models) =>
        set((state) => ({ byProvider: { ...state.byProvider, [providerId]: models } })),
    }),
    {
      name: "rim-agent-live-models",
      partialize: (state) => ({ byProvider: state.byProvider }),
    },
  ),
);

/** The live list's entry for `modelId` of `providerId`, if the list has one. */
export function liveModel(
  byProvider: Record<string, AiModelDef[]>,
  providerId: string,
  modelId: string,
): AiModelDef | undefined {
  return byProvider[providerId]?.find((m) => m.id === modelId);
}
