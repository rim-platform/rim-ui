import { afterEach, describe, expect, it } from "vitest";

import { agentAvailable, commandOfferedHere } from "./agentAvailability";

describe("agentAvailability", () => {
  afterEach(() => {
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it("has no agent and does not offer workspace.open_agent on the web", () => {
    expect(agentAvailable()).toBe(false);
    expect(commandOfferedHere("workspace.open_agent")).toBe(false);
    expect(commandOfferedHere("workspace.open_settings")).toBe(true);
  });

  it("has the agent and offers its command in the desktop app", () => {
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};

    expect(agentAvailable()).toBe(true);
    expect(commandOfferedHere("workspace.open_agent")).toBe(true);
    expect(commandOfferedHere("workspace.open_settings")).toBe(true);
  });
});
