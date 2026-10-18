import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  BUILTIN_CAPABILITIES,
  ManifestError,
  parseManifest,
  parseNetworkOrigin,
  settingValueError,
  siteOf,
  validateManifest,
} from "../src/manifestRules.ts";

const vectors = JSON.parse(
  readFileSync(new URL("../../../protocol/manifest-vectors.json", import.meta.url), "utf8"),
);

describe("manifest rules", () => {
  it("judge the shared vectors as the desktop host does", () => {
    expect(vectors.vectors.length).toBeGreaterThan(50);
    for (const vector of vectors.vectors) {
      let verdict: string = "valid";
      try {
        validateManifest(vector.manifest, { forbiddenOrigins: vectors.forbiddenOrigins });
      } catch (error) {
        expect(error, vector.name).toBeInstanceOf(ManifestError);
        verdict = (error as Error).message;
      }
      expect({ name: vector.name, valid: verdict === "valid", verdict }).toMatchObject({
        name: vector.name,
        valid: vector.valid,
      });
    }
  });

  it("know the built-in capabilities the desktop host knows", () => {
    expect([...BUILTIN_CAPABILITIES]).toEqual(vectors.builtinCapabilities);
  });

  const desktop = {
    manifest_version: 1,
    plugin_id: "dev.example.poll",
    display_name: "Poll",
    version: "0.1.0",
    description: "Runs polls.",
    runtime_kind: "DesktopLocalProcess",
    entrypoint: "main.mjs",
  };

  it("refuse a broken setting, naming its position and key", () => {
    expect(() =>
      validateManifest({
        ...desktop,
        settings_schema: [
          { key: "namespace", title: "Namespace", value_type: "string" },
          { key: "refresh", title: "Refresh", value_type: "integer", min: 5, default: 1 },
        ],
      }),
    ).toThrow("invalid settings_schema[1] `refresh`: default must be at least 5");
  });

  it("keep a setting's optional fields only when the manifest sets them", () => {
    const [plain, full] = parseManifest({
      ...desktop,
      settings_schema: [
        { key: "a", title: "A", value_type: "string", default: null },
        {
          key: "b",
          title: "B",
          value_type: "integer",
          default: 3,
          min: 1,
          max: 9,
          placeholder: "3",
        },
      ],
    }).settings_schema;
    expect(plain).toEqual({
      key: "a",
      title: "A",
      description: "",
      value_type: "string",
      is_secret: false,
    });
    expect(full).toMatchObject({ default: 3, min: 1, max: 9, placeholder: "3" });
  });

  it("check a setting's value by its type, bounds and options", () => {
    const integer = {
      key: "n",
      title: "N",
      description: "",
      value_type: "integer",
      is_secret: false,
      min: -3,
      max: 3,
    };
    expect(settingValueError(integer, 3)).toBeNull();
    expect(settingValueError(integer, -4)).toBe("must be at least -3");
    expect(settingValueError(integer, 1.5)).toBe("must be an integer");
    expect(settingValueError(integer, 2 ** 53)).toBe("must lie between -(2^53 - 1) and 2^53 - 1");
    const choice = { ...integer, value_type: "enum", options: ["a", "b"] };
    expect(settingValueError(choice, "b")).toBeNull();
    expect(settingValueError(choice, "c")).toBe("must be one of: a, b");
    expect(settingValueError({ ...integer, value_type: "path" }, 1)).toBe("must be a string");
    expect(settingValueError({ ...integer, value_type: "boolean" }, "true")).toBe(
      "must be true or false",
    );
  });

  it("refuse a plugin-scoped capability and name it", () => {
    expect(() =>
      validateManifest({ ...desktop, capabilities: ["plugin.dev.example.poll.vote"] }),
    ).toThrow(
      "invalid capability key `plugin.dev.example.poll.vote`: plugin-scoped capability keys are not supported, since the permission prompt cannot approve them; a manifest names only built-in capabilities: ui.panel, ui.notify, chat.read, chat.write, chat.read.encrypted, chat.write.encrypted",
    );
  });

  it("refuse a command requiring a name that is not built-in, naming the command", () => {
    expect(() =>
      validateManifest({
        ...desktop,
        capabilities: ["chat.read"],
        commands: [
          {
            id: "vote",
            title: "Vote",
            description: "Votes.",
            required_capabilities: ["chat.admin"],
          },
        ],
      }),
    ).toThrow(
      "invalid capability key `chat.admin`: required by command `vote`: not a built-in capability; a manifest names only built-in capabilities: ui.panel, ui.notify, chat.read, chat.write, chat.read.encrypted, chat.write.encrypted",
    );
  });

  it("refuse a command requiring a capability the manifest does not declare", () => {
    const command = { id: "vote", title: "Vote", description: "Votes." };
    expect(() =>
      validateManifest({
        ...desktop,
        capabilities: ["chat.read"],
        commands: [{ ...command, required_capabilities: ["chat.read", "chat.write"] }],
      }),
    ).toThrow(
      "command `vote` requires capability `chat.write`, which the manifest's capabilities do not declare",
    );
    expect(() =>
      validateManifest({
        ...desktop,
        capabilities: ["chat.read", "chat.write"],
        commands: [{ ...command, required_capabilities: ["chat.read", "chat.write"] }],
      }),
    ).not.toThrow();
  });

  it("explains why a web plugin cannot hold a local capability", () => {
    expect(() =>
      validateManifest({
        ...vectors.vectors[0].manifest,
        capabilities: ["fs.read"],
      }),
    ).toThrow("WebSandboxed plugins cannot run programs or read files; use DesktopLocalProcess");
  });

  it("names sites without the default port", () => {
    expect(siteOf(parseNetworkOrigin("https://api.github.com:443"))).toBe("api.github.com");
    expect(siteOf(parseNetworkOrigin("wss://stream.example.com:8443"))).toBe(
      "stream.example.com:8443",
    );
  });
});
