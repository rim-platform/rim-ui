import { beforeEach, describe, expect, it, vi } from "vitest";

const safeInvokeMock = vi.fn();

vi.mock("../../../core/tauri/safeInvoke", () => ({
  safeInvoke: (...args: unknown[]) => safeInvokeMock(...args),
}));

import {
  agentBridgeAck,
  agentBridgeAnswer,
  agentBridgeSetEnabled,
  agentBridgeStatus,
} from "./agentBridge";

const STATUS = { enabled: true, listening: true, error: null, port: 47821 };

describe("agentBridge", () => {
  beforeEach(() => {
    safeInvokeMock.mockReset().mockResolvedValue({ ok: true, value: null });
  });

  it("reads the status", async () => {
    safeInvokeMock.mockResolvedValue({ ok: true, value: STATUS });
    await expect(agentBridgeStatus()).resolves.toEqual(STATUS);
    expect(safeInvokeMock).toHaveBeenCalledWith("agent_bridge_status", undefined);
  });

  it("saves the setting and returns the status", async () => {
    safeInvokeMock.mockResolvedValue({ ok: true, value: STATUS });
    await expect(agentBridgeSetEnabled(true)).resolves.toEqual(STATUS);
    expect(safeInvokeMock).toHaveBeenCalledWith("agent_bridge_set_enabled", { enabled: true });
  });

  it("acknowledges a request", async () => {
    await agentBridgeAck(7);
    expect(safeInvokeMock).toHaveBeenCalledWith("agent_bridge_ack", { id: 7 });
  });

  it("answers a request", async () => {
    await agentBridgeAnswer(7, 200, "{}");
    expect(safeInvokeMock).toHaveBeenCalledWith("agent_bridge_answer", {
      id: 7,
      status: 200,
      body: "{}",
    });
  });

  it("throws the error of a failed call", async () => {
    const error = new Error("could not save");
    safeInvokeMock.mockResolvedValue({ ok: false, error });
    await expect(agentBridgeSetEnabled(false)).rejects.toBe(error);
  });
});
