import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../shared/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import { toast } from "../../../shared/toast";
import {
  CANCELLED_PAYLOAD,
  findPluginCommand,
  isCancelledResult,
  toastPluginCommandResult,
} from "./pluginCommandInfo";
import type { PluginInfo } from "../types";

describe("findPluginCommand", () => {
  it("matches the whole qualified id, dots in the plugin id included", () => {
    queryClient.setQueryData<Partial<PluginInfo>[]>(queryKeys.plugins(), [
      {
        plugin_id: "chat.rim.k8s-pods",
        display_name: "Kubernetes Pods",
        commands: [
          {
            id: "refresh",
            qualified_id: "plugin.chat.rim.k8s-pods.refresh",
            title: "Refresh pods",
            description: "",
            keybind_capable: true,
            dangerous: false,
            ai_callable: true,
            arguments: [],
          },
        ],
      },
    ]);
    expect(findPluginCommand("plugin.chat.rim.k8s-pods.refresh")).toMatchObject({
      title: "Refresh pods",
      pluginName: "Kubernetes Pods",
    });
    expect(findPluginCommand("plugin.chat.rim.refresh")).toBeNull();
    queryClient.removeQueries({ queryKey: queryKeys.plugins() });
  });
});

describe("toastPluginCommandResult", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the plugin's message", () => {
    toastPluginCommandResult("Refresh pods", {
      status: "SUCCESS",
      message: "3 pods in shop (kind-dev)",
      payload: { pods: [] },
      followUpCommands: [],
    });
    expect(toast.success).toHaveBeenCalledWith("Refresh pods: 3 pods in shop (kind-dev)");
  });

  it("shows a failure", () => {
    toastPluginCommandResult("Refresh pods", {
      status: "ERROR",
      message: "Cannot reach the cluster",
      payload: null,
      followUpCommands: [],
    });
    expect(toast.error).toHaveBeenCalledWith("Refresh pods: Cannot reach the cluster");
    toastPluginCommandResult("Refresh pods", null);
    expect(toast.error).toHaveBeenLastCalledWith("Refresh pods: Command failed");
  });

  it("stays quiet when the user declined to confirm", () => {
    const cancelled = {
      status: "ERROR" as const,
      message: "Cancelled",
      payload: CANCELLED_PAYLOAD,
      followUpCommands: [],
    };
    expect(isCancelledResult(cancelled)).toBe(true);
    // A plugin cannot fake a cancellation with a look-alike payload.
    expect(isCancelledResult({ payload: { cancelled: true } })).toBe(false);
    toastPluginCommandResult("Restart pod", cancelled);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });
});
