import { describe, expect, it } from "vitest";

import {
  TOOL_NAME_MAX_LENGTH,
  buildRequestToolNameMap,
  buildToolNameMap,
  isValidToolName,
} from "./toolNames";

describe("buildToolNameMap", () => {
  it("keeps names the APIs already accept, hyphens and underscores included", () => {
    const names = ["get_current_context", "plugin__chat_rim_k8s-pods__refresh", "a-b_c9"];
    const map = buildToolNameMap(names);
    for (const name of names) {
      expect(map.toApi(name)).toBe(name);
      expect(map.fromApi(name)).toBe(name);
    }
  });

  it("replaces dots in command ids and maps the call back to the exact id", () => {
    const map = buildToolNameMap(["chat.send_message", "incident.ack"]);
    expect(map.toApi("chat.send_message")).toBe("chat_send_message");
    expect(map.toApi("incident.ack")).toBe("incident_ack");
    expect(map.fromApi("chat_send_message")).toBe("chat.send_message");
    expect(map.fromApi("incident_ack")).toBe("incident.ack");
  });

  it("never lets a translated id take a name that already exists", () => {
    // Order must not matter: the valid name keeps itself either way.
    for (const names of [
      ["chat.send_message", "chat_send_message"],
      ["chat_send_message", "chat.send_message"],
    ]) {
      const map = buildToolNameMap(names);
      expect(map.toApi("chat_send_message")).toBe("chat_send_message");
      expect(map.toApi("chat.send_message")).toBe("chat_send_message_2");
      expect(map.fromApi("chat_send_message")).toBe("chat_send_message");
      expect(map.fromApi("chat_send_message_2")).toBe("chat.send_message");
    }
  });

  it("gives ids that translate alike distinct names", () => {
    const map = buildToolNameMap(["a.b", "a:b", "a b", "a_b_2"]);
    const apiNames = ["a.b", "a:b", "a b"].map((n) => map.toApi(n));
    expect(new Set([...apiNames, "a_b_2"]).size).toBe(4);
    expect(apiNames).toEqual(["a_b", "a_b_3", "a_b_4"]);
    for (const name of ["a.b", "a:b", "a b", "a_b_2"]) {
      expect(map.fromApi(map.toApi(name))).toBe(name);
    }
  });

  it("keeps every name within the length limit, suffixes included", () => {
    const long = "x".repeat(70);
    const names = [`${long}.one`, `${long}.two`, "y".repeat(TOOL_NAME_MAX_LENGTH + 1)];
    const map = buildToolNameMap(names);
    const apiNames = names.map((n) => map.toApi(n));
    for (const apiName of apiNames) {
      expect(isValidToolName(apiName)).toBe(true);
    }
    expect(new Set(apiNames).size).toBe(names.length);
    expect(apiNames[1]).toBe(`${"x".repeat(TOOL_NAME_MAX_LENGTH - 2)}_2`);
    for (const name of names) {
      expect(map.fromApi(map.toApi(name))).toBe(name);
    }
  });

  it("names an empty or all-invalid id something valid", () => {
    const map = buildToolNameMap(["", "..."]);
    expect(map.toApi("")).toBe("tool");
    expect(map.toApi("...")).toBe("___");
    expect(map.fromApi("tool")).toBe("");
  });

  it("passes unknown names through unchanged", () => {
    const map = buildToolNameMap(["chat.send_message"]);
    expect(map.fromApi("made_up")).toBe("made_up");
    expect(map.toApi("not.offered")).toBe("not.offered");
  });

  it("round-trips a realistic tool set, all names valid and distinct", () => {
    const names = [
      "get_current_context",
      "chat.send_message",
      "chat.list_channels",
      "chat.open_thread",
      "incident.ack",
      "incident.declare",
      "workspace.switch",
      "plugin__chat_rim_k8s-pods__refresh",
    ];
    const map = buildToolNameMap(names);
    const apiNames = names.map((n) => map.toApi(n));
    expect(apiNames.every(isValidToolName)).toBe(true);
    expect(new Set(apiNames).size).toBe(names.length);
    expect(apiNames.map((n) => map.fromApi(n))).toEqual(names);
  });
});

describe("buildRequestToolNameMap", () => {
  it("covers tools named only in the history, after the offered tools", () => {
    const map = buildRequestToolNameMap(
      [{ name: "chat.send_message", description: "", input_schema: {} }],
      [
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "ok" },
            { type: "tool_use", id: "t1", name: "chat.removed", input: {} },
          ],
        },
      ],
    );
    expect(map.toApi("chat.send_message")).toBe("chat_send_message");
    expect(map.toApi("chat.removed")).toBe("chat_removed");
    expect(map.fromApi("chat_removed")).toBe("chat.removed");
  });

  it("works without tools", () => {
    const map = buildRequestToolNameMap(undefined, [{ role: "user", content: "hi" }]);
    expect(map.fromApi("anything")).toBe("anything");
  });
});
