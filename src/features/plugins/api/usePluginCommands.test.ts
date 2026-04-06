import { describe, it, expect } from "vitest";
import { parsePluginCommandId } from "./usePluginCommands";

describe("parsePluginCommandId", () => {
  it("parses a valid plugin command ID", () => {
    const result = parsePluginCommandId("plugin.my-plugin.do_something");
    expect(result).toEqual({
      pluginId: "my-plugin",
      command: "do_something",
    });
  });

  it("parses command ID with dots in the command part", () => {
    const result = parsePluginCommandId("plugin.my-plugin.sub.command");
    expect(result).toEqual({
      pluginId: "my-plugin",
      command: "sub.command",
    });
  });

  it("returns null for non-plugin command IDs", () => {
    expect(parsePluginCommandId("chat.send_message")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parsePluginCommandId("")).toBeNull();
  });

  it("returns null for malformed plugin prefix", () => {
    expect(parsePluginCommandId("plugin.")).toBeNull();
  });

  it("returns null for just 'plugin' with no dots", () => {
    expect(parsePluginCommandId("plugin")).toBeNull();
  });

  it("returns null for 'plugin.only-id' (missing command)", () => {
    expect(parsePluginCommandId("plugin.only-id")).toBeNull();
  });

  it("parses plugin ID with underscores", () => {
    const result = parsePluginCommandId("plugin.my_plugin.run_task");
    expect(result).toEqual({
      pluginId: "my_plugin",
      command: "run_task",
    });
  });

  it("parses plugin ID with numbers", () => {
    const result = parsePluginCommandId("plugin.plugin123.cmd456");
    expect(result).toEqual({
      pluginId: "plugin123",
      command: "cmd456",
    });
  });
});
