import { describe, expect, it } from "vitest";

import {
  cargoLockVersion,
  cargoTomlVersion,
  compareVersions,
  cutChangelog,
  isVersion,
  recordedVersions,
  setCargoLockVersion,
  setCargoTomlVersion,
  versionMismatch,
} from "./versions.mjs";

const CARGO_TOML = `[package]
name = "rim-ui"
version = "0.0.1"
edition = "2021"

[dependencies]
serde = { version = "1" }

[profile.wasm]
version = "not this one"
`;

const CARGO_LOCK = `version = 4

[[package]]
name = "rim-mls"
version = "0.0.1"

[[package]]
name = "rim-ui"
version = "0.0.1"
dependencies = [
 "serde",
]

[[package]]
name = "rim-ui-extra"
version = "0.0.1"
`;

function files({ pkg = "0.0.1", lock = "0.0.1", root = "0.0.1", tauri = "../package.json" } = {}) {
  return {
    packageJson: JSON.stringify({ name: "rim-ui", version: pkg }),
    packageLock: JSON.stringify({ version: lock, packages: { "": { version: root } } }),
    cargoToml: CARGO_TOML,
    cargoLock: CARGO_LOCK,
    tauriConf: JSON.stringify({ productName: "RIM", version: tauri }),
  };
}

const CHANGELOG_HEAD = `# Changelog

Intro mentioning ## [Unreleased] inline is not a heading.

`;

describe("isVersion", () => {
  it("accepts release and pre-release versions only", () => {
    for (const v of ["0.0.1", "1.20.300", "0.2.0-rc.1", "1.0.0-alpha-1.x"]) {
      expect(isVersion(v)).toBe(true);
    }
    for (const v of ["v0.0.1", "0.1", "01.0.0", "1.0.0-01", "1.0.0+build", "", undefined]) {
      expect(isVersion(v)).toBe(false);
    }
  });
});

describe("compareVersions", () => {
  it("orders versions by Semantic Versioning precedence", () => {
    const ordered = [
      "0.0.1",
      "0.1.0",
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-alpha.beta",
      "1.0.0-beta",
      "1.0.0-beta.2",
      "1.0.0-beta.11",
      "1.0.0-rc.1",
      "1.0.0",
      "1.10.0",
    ];
    for (let i = 0; i < ordered.length - 1; i++) {
      expect(compareVersions(ordered[i], ordered[i + 1])).toBe(-1);
      expect(compareVersions(ordered[i + 1], ordered[i])).toBe(1);
      expect(compareVersions(ordered[i], ordered[i])).toBe(0);
    }
  });

  it("refuses what is not a version", () => {
    expect(() => compareVersions("1.0", "1.0.0")).toThrow("not a version: 1.0");
  });
});

describe("Cargo.toml", () => {
  it("reads and sets the version under [package] only", () => {
    expect(cargoTomlVersion(CARGO_TOML)).toBe("0.0.1");
    const out = setCargoTomlVersion(CARGO_TOML, "0.0.2");
    expect(cargoTomlVersion(out)).toBe("0.0.2");
    expect(out.replace('"0.0.2"', '"0.0.1"')).toBe(CARGO_TOML);
  });

  it("refuses a manifest without a package version", () => {
    expect(() => cargoTomlVersion("[workspace]\n")).toThrow("no [package] table");
    expect(() => setCargoTomlVersion('[package]\nname = "x"\n', "1.0.0")).toThrow(
      "no version under [package]",
    );
  });
});

describe("Cargo.lock", () => {
  it("reads and sets the rim-ui entry only", () => {
    expect(cargoLockVersion(CARGO_LOCK)).toBe("0.0.1");
    const out = setCargoLockVersion(CARGO_LOCK, "0.0.2");
    expect(cargoLockVersion(out)).toBe("0.0.2");
    expect(cargoLockVersion(out, "rim-mls")).toBe("0.0.1");
    expect(cargoLockVersion(out, "rim-ui-extra")).toBe("0.0.1");
    expect(out.replace('"0.0.2"', '"0.0.1"')).toBe(CARGO_LOCK);
  });

  it("refuses a lock file without the package", () => {
    expect(() => setCargoLockVersion("version = 4\n", "1.0.0")).toThrow("no package rim-ui");
  });
});

describe("recordedVersions and versionMismatch", () => {
  it("passes when every file records one version", () => {
    const entries = recordedVersions(files());
    expect(entries.map((e) => e.version)).toEqual(["0.0.1", "0.0.1", "0.0.1", "0.0.1", "0.0.1"]);
    expect(versionMismatch(entries)).toBeNull();
  });

  it("names every source when one disagrees", () => {
    const message = versionMismatch(recordedVersions(files({ root: "0.1.0" })));
    expect(message).toContain("The versions disagree:");
    expect(message).toContain('package-lock.json (packages[""].version): 0.1.0');
    expect(message).toContain("src-tauri/Cargo.lock (rim-ui): 0.0.1");
    expect(message).toContain("npm run version:set -- <version>");
  });

  it("checks a version written into tauri.conf.json instead of the package.json link", () => {
    const entries = recordedVersions(files({ tauri: "0.1.0" }));
    expect(entries.at(-1)).toEqual({ source: "src-tauri/tauri.conf.json", version: "0.1.0" });
    expect(versionMismatch(entries)).toContain("src-tauri/tauri.conf.json: 0.1.0");
  });

  it("refuses a missing or malformed version even when all agree", () => {
    const all = (v) => files({ pkg: v, lock: v, root: v });
    const lockless = { ...files(), packageLock: JSON.stringify({ version: "0.0.1" }) };
    expect(versionMismatch(recordedVersions(lockless))).toContain("(missing)");
    const bad = { ...all("0.1"), cargoToml: setCargoTomlVersion(CARGO_TOML, "0.1") };
    bad.cargoLock = setCargoLockVersion(CARGO_LOCK, "0.1");
    expect(versionMismatch(recordedVersions(bad))).toContain("is not <major>.<minor>.<patch>");
  });
});

describe("cutChangelog", () => {
  const unreleased = `## [Unreleased]

### Added

- Installers.
`;

  it("cuts the first release and links it to its tag", () => {
    const text = `${CHANGELOG_HEAD}${unreleased}
[Unreleased]: https://github.com/rim-platform/rim-ui/commits/master
`;
    expect(cutChangelog(text, "0.0.1", "2026-10-16")).toBe(`${CHANGELOG_HEAD}## [Unreleased]

## [0.0.1] - 2026-10-16

### Added

- Installers.

[Unreleased]: https://github.com/rim-platform/rim-ui/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/rim-platform/rim-ui/releases/tag/v0.0.1
`);
  });

  it("links a later release to a comparison with the previous one", () => {
    const text = `${CHANGELOG_HEAD}${unreleased}
## [0.0.1] - 2026-10-16

- First.

[Unreleased]: https://github.com/rim-platform/rim-ui/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/rim-platform/rim-ui/releases/tag/v0.0.1
`;
    const out = cutChangelog(text, "0.0.2", "2026-11-01");
    expect(out).toContain("## [Unreleased]\n\n## [0.0.2] - 2026-11-01\n\n### Added\n");
    expect(out)
      .toContain(`[Unreleased]: https://github.com/rim-platform/rim-ui/compare/v0.0.2...HEAD
[0.0.2]: https://github.com/rim-platform/rim-ui/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/rim-platform/rim-ui/releases/tag/v0.0.1
`);
  });

  it("leaves a changelog without link references without them", () => {
    const out = cutChangelog(`${CHANGELOG_HEAD}${unreleased}`, "1.0.0", "2026-12-01");
    expect(out).toBe(
      `${CHANGELOG_HEAD}## [Unreleased]\n\n## [1.0.0] - 2026-12-01\n\n### Added\n\n- Installers.\n`,
    );
  });

  it("refuses a version that has a section, an empty Unreleased and bad input", () => {
    const released = `${CHANGELOG_HEAD}${unreleased}\n## [0.0.1] - 2026-10-16\n\n- First.\n`;
    expect(() => cutChangelog(released, "0.0.1", "2026-10-16")).toThrow(
      "already has a section [0.0.1]",
    );
    const empty = `${CHANGELOG_HEAD}## [Unreleased]\n\n## [0.0.1] - 2026-10-16\n\n- First.\n\n[Unreleased]: https://x/commits/master\n`;
    expect(() => cutChangelog(empty, "0.0.2", "2026-10-16")).toThrow("no entries under Unreleased");
    expect(() => cutChangelog(CHANGELOG_HEAD, "0.0.2", "2026-10-16")).toThrow(
      "no ## [Unreleased] section",
    );
    expect(() => cutChangelog(released, "v0.0.2", "2026-10-16")).toThrow("not a version");
    expect(() => cutChangelog(released, "0.0.2", "16.10.2026")).toThrow("not a date");
  });
});
