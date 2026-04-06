import { describe, it, expect } from "vitest";
import { getSlashCommandSuggestions, isSlashCommand, SLASH_COMMANDS } from "./slashCommands";

describe("getSlashCommandSuggestions", () => {
  it("returns all commands for /", () => {
    const suggestions = getSlashCommandSuggestions("/");
    expect(suggestions.length).toBe(SLASH_COMMANDS.length);
  });

  it("returns matching commands for /a", () => {
    const suggestions = getSlashCommandSuggestions("/a");
    expect(suggestions.some((c) => c.command === "/agent")).toBe(true);
  });

  it("returns matching commands for /m", () => {
    const suggestions = getSlashCommandSuggestions("/m");
    expect(suggestions.some((c) => c.command === "/macro")).toBe(true);
  });

  it("returns empty for non-matching prefix", () => {
    const suggestions = getSlashCommandSuggestions("/zzz");
    expect(suggestions).toEqual([]);
  });
});

describe("isSlashCommand", () => {
  it("recognizes /agent command", () => {
    const result = isSlashCommand("/agent some question");
    expect(result).not.toBeNull();
    expect(result!.command).toBe("/agent");
  });

  it("recognizes /macro command", () => {
    const result = isSlashCommand("/macro my-macro");
    expect(result).not.toBeNull();
    expect(result!.command).toBe("/macro");
  });

  it("returns null for non-slash text", () => {
    expect(isSlashCommand("hello world")).toBeNull();
  });

  it("returns null for unknown slash command", () => {
    expect(isSlashCommand("/unknown stuff")).toBeNull();
  });

  it("is case-insensitive", () => {
    const result = isSlashCommand("/AGENT question");
    expect(result).not.toBeNull();
  });
});
