import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
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
