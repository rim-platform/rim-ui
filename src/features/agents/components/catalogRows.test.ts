import { describe, expect, it } from "vitest";

import { ACP_PRESETS } from "../acp/acpPresets";
import type { CatalogEntry, InstallerCatalog } from "../acp/agentInstaller";
import { diskUseLine, offerLine, usesLine } from "./catalogRows";

const OFFER = { version: "0.102.0", license: "proprietary", source: "github.com/x" };

function entry(presetId: string, installed: boolean): CatalogEntry {
  return {
    presetId,
    name: presetId,
    available: null,
    installed: installed
      ? {
          presetId,
          version: "1.0.0",
          program: `/a/${presetId}`,
          args: [],
          installedAt: 1,
          diskBytes: null,
        }
      : null,
    problem: null,
  };
}

function catalog(installed: string[], rest: Partial<InstallerCatalog> = {}): InstallerCatalog {
  return {
    agents: ACP_PRESETS.map((preset) => entry(preset.id, installed.includes(preset.id))),
    node: null,
    nodeDownload: null,
    totalBytes: 1_200_000_000,
    ...rest,
  };
}

describe("catalogRows", () => {
  it("adds the size of the offer when it is known", () => {
    expect(offerLine({ ...OFFER, size: null })).toBe("0.102.0 · proprietary licence");
    expect(offerLine({ ...OFFER, size: { bytes: 120_000_000, kind: "download" } })).toBe(
      "0.102.0 · proprietary licence · about 120 MB download",
    );
    expect(offerLine({ ...OFFER, size: { bytes: 4_240_000, kind: "installed" } })).toBe(
      "0.102.0 · proprietary licence · about 4.2 MB installed",
    );
  });

  it("says what an installed agent uses when it is known", () => {
    const installed = entry("goose", true).installed;
    if (installed === null) throw new Error("installed");
    expect(usesLine(installed)).toBeNull();
    expect(usesLine({ ...installed, diskBytes: 433_200_000 })).toBe("Uses 433 MB");
  });

  it("sums up what RIM's agents use, with Node.js and who runs on it", () => {
    expect(diskUseLine(catalog([]), ACP_PRESETS)).toBeNull();
    expect(diskUseLine(catalog(["goose"]), ACP_PRESETS)).toBe(
      "Agents installed by RIM use 1.2 GB on this computer.",
    );
    const node = { version: "26.13.0", diskBytes: 214_000_000 };
    expect(diskUseLine(catalog(["codex", "gemini-cli", "goose"], { node }), ACP_PRESETS)).toBe(
      "Agents installed by RIM use 1.2 GB on this computer, including Node.js 26.13.0 (214 MB), " +
        "shared by Codex and Gemini CLI.",
    );
    expect(diskUseLine(catalog(["gemini-cli"], { node }), ACP_PRESETS)).toBe(
      "Agents installed by RIM use 1.2 GB on this computer, including Node.js 26.13.0 (214 MB), " +
        "used by Gemini CLI.",
    );
    expect(
      diskUseLine(catalog([], { node: { version: "26.13.0", diskBytes: null } }), ACP_PRESETS),
    ).toBe("Agents installed by RIM use 1.2 GB on this computer, including Node.js 26.13.0.");
  });
});
