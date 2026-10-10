import { describe, it, expect, beforeEach } from "vitest";
import {
  registerTool,
  unregisterTool,
  getTool,
  getAllToolDefinitions,
  getAllTools,
} from "./registry";

describe("agent tool registry", () => {
  const testDefinition = {
    name: "test_tool",
    description: "A test tool",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Search query" },
      },
      required: ["query"],
    },
  };

  const testHandler = async () => ({ result: "ok" });

  beforeEach(() => {
    // Clean up registered tools
    unregisterTool("test_tool");
    unregisterTool("another_tool");
  });

  it("registers and retrieves a tool", () => {
    registerTool(testDefinition, testHandler);
    const tool = getTool("test_tool");
    expect(tool).toBeDefined();
    expect(tool!.definition.name).toBe("test_tool");
  });

  it("returns undefined for unregistered tool", () => {
    expect(getTool("nonexistent")).toBeUndefined();
  });

  it("unregisters a tool", () => {
    registerTool(testDefinition, testHandler);
    unregisterTool("test_tool");
    expect(getTool("test_tool")).toBeUndefined();
  });

  it("getAllToolDefinitions returns definitions", () => {
    registerTool(testDefinition, testHandler);
    const defs = getAllToolDefinitions();
    expect(defs.some((d) => d.name === "test_tool")).toBe(true);
  });

  it("getAllTools returns full registered tools", () => {
    registerTool(testDefinition, testHandler);
    const tools = getAllTools();
    expect(tools.some((t) => t.definition.name === "test_tool")).toBe(true);
  });

  it("registers tool with sideEffect option", () => {
    registerTool(testDefinition, testHandler, { sideEffect: true });
    const tool = getTool("test_tool");
    expect(tool!.sideEffect).toBe(true);
  });

  it("registers tool with description option and getTool returns it (C2 §4)", () => {
    registerTool(testDefinition, testHandler, {
      description:
        "Archive a channel. Members can still read it, but nobody can post until it is unarchived.",
    });
    const tool = getTool("test_tool");
    expect(tool!.description).toBe(
      "Archive a channel. Members can still read it, but nobody can post until it is unarchived.",
    );
  });

  it("overwrites existing tool on re-register", () => {
    registerTool(testDefinition, testHandler);
    const newHandler = async () => ({ result: "new" });
    registerTool(testDefinition, newHandler);
    const tool = getTool("test_tool");
    expect(tool!.handler).toBe(newHandler);
  });
});
