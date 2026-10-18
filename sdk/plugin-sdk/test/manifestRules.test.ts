import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  BUILTIN_CAPABILITIES,
  ManifestError,
  parseNetworkOrigin,
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
