import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  classify,
  downloadTable,
  latestJson,
  readBundles,
  readNotices,
  sha256sums,
} from "./release-assets.mjs";

const REPO = "rim-platform/rim-ui";
const OPTIONS = { version: "0.0.1", repo: REPO, pubDate: "2026-10-16T12:00:00Z" };
const DOWNLOAD = "https://github.com/rim-platform/rim-ui/releases/download/v0.0.1/";
const SCRIPT = new URL("./release-assets.mjs", import.meta.url);

/** The files a Linux and a Windows leg upload, each bundle's contents its type. */
const RELEASE_FILES = {
  "RIM_0.0.1_amd64.AppImage": "appimage",
  "RIM_0.0.1_amd64.AppImage.sig": "sig-appimage\n",
  "RIM_0.0.1_amd64.deb": "deb",
  "RIM_0.0.1_amd64.deb.sig": "sig-deb\n",
  "RIM-0.0.1-1.x86_64.rpm": "rpm",
  "RIM-0.0.1-1.x86_64.rpm.sig": "sig-rpm\n",
  "RIM_0.0.1_x64-setup.exe": "nsis",
  "RIM_0.0.1_x64-setup.exe.sig": "sig-nsis\n",
  "RIM_0.0.1_x64_en-US.msi": "msi",
  "RIM_0.0.1_x64_en-US.msi.sig": "sig-msi\n",
  "THIRD-PARTY-LICENSES.txt": "notices",
};

let dir;

function writeFiles(files) {
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
}

function without(...names) {
  return Object.fromEntries(Object.entries(RELEASE_FILES).filter(([n]) => !names.includes(n)));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "release-assets-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("classify", () => {
  it("names the bundle type and architectures from the file name", () => {
    expect(classify("RIM_0.0.1_amd64.AppImage")).toMatchObject({ os: "linux", arches: ["x86_64"] });
    expect(classify("RIM-0.0.1-1.x86_64.rpm")).toMatchObject({ os: "linux", arches: ["x86_64"] });
    expect(classify("RIM_0.0.1_x64-setup.exe")).toMatchObject({
      os: "windows",
      installer: "nsis",
      default: true,
    });
    expect(classify("RIM_0.0.1_aarch64.dmg")).toMatchObject({ os: "darwin", arches: ["aarch64"] });
    expect(classify("RIM_0.0.1_universal.app.tar.gz")).toMatchObject({
      os: "darwin",
      arches: ["x86_64", "aarch64"],
      installer: "app",
    });
    expect(classify("RIM_0.0.1_universal.dmg")).not.toHaveProperty("installer");
    expect(classify("RIM_0.0.1_amd64.AppImage.sig")).toBeNull();
    expect(classify("notes.txt")).toBeNull();
  });

  it("refuses a bundle without an architecture", () => {
    expect(() => classify("RIM.app.tar.gz")).toThrow("RIM.app.tar.gz: no architecture");
  });
});

describe("readBundles", () => {
  it("reads every bundle with its digest and signature, Linux first", () => {
    writeFiles(RELEASE_FILES);
    const bundles = readBundles(dir);
    expect(bundles.map((b) => b.name)).toEqual([
      "RIM_0.0.1_amd64.AppImage",
      "RIM_0.0.1_amd64.deb",
      "RIM-0.0.1-1.x86_64.rpm",
      "RIM_0.0.1_x64-setup.exe",
      "RIM_0.0.1_x64_en-US.msi",
    ]);
    expect(bundles[0]).toMatchObject({
      size: 8,
      // sha256 of "appimage"
      sha256: "8b408ed68dfd56d503752ff2ee2ecb3c0ffa55a26f6fa107bd4444c3943ee6e1",
      signature: "sig-appimage",
    });
    expect(bundles[1].signature).toBe("sig-deb");
    writeFiles({ "RIM_0.0.1_universal.dmg": "dmg" });
    expect(readBundles(dir).find((b) => b.name.endsWith(".dmg")).signature).toBeNull();
  });

  it("refuses a stray file and a signature without its bundle", () => {
    writeFiles({ ...RELEASE_FILES, "release-notes.md": "x" });
    expect(() => readBundles(dir)).toThrow("release-notes.md: not a desktop bundle");
    rmSync(join(dir, "release-notes.md"));
    rmSync(join(dir, "RIM_0.0.1_amd64.deb"));
    writeFiles({ "RIM_0.0.1_amd64.deb.sig": "x" });
    expect(() => readBundles(dir)).toThrow("RIM_0.0.1_amd64.deb.sig: no bundle for it");
    rmSync(join(dir, "THIRD-PARTY-LICENSES.txt"));
    expect(() => readNotices(dir)).toThrow("THIRD-PARTY-LICENSES.txt: missing");
  });
});

describe("latestJson", () => {
  it("lists every installer's bundle, and each platform's default, with the signature text", () => {
    writeFiles(RELEASE_FILES);
    const entry = (sig, name) => ({ signature: sig, url: `${DOWNLOAD}${name}` });
    expect(latestJson(readBundles(dir), OPTIONS)).toEqual({
      version: "0.0.1",
      notes: "https://github.com/rim-platform/rim-ui/releases/tag/v0.0.1",
      pub_date: "2026-10-16T12:00:00Z",
      platforms: {
        "linux-x86_64-appimage": entry("sig-appimage", "RIM_0.0.1_amd64.AppImage"),
        "linux-x86_64": entry("sig-appimage", "RIM_0.0.1_amd64.AppImage"),
        "linux-x86_64-deb": entry("sig-deb", "RIM_0.0.1_amd64.deb"),
        "linux-x86_64-rpm": entry("sig-rpm", "RIM-0.0.1-1.x86_64.rpm"),
        "windows-x86_64-nsis": entry("sig-nsis", "RIM_0.0.1_x64-setup.exe"),
        "windows-x86_64": entry("sig-nsis", "RIM_0.0.1_x64-setup.exe"),
        "windows-x86_64-msi": entry("sig-msi", "RIM_0.0.1_x64_en-US.msi"),
      },
    });
  });

  it("fills both macOS architectures from a universal archive", () => {
    writeFiles({
      ...RELEASE_FILES,
      "RIM_0.0.1_universal.app.tar.gz": "app",
      "RIM_0.0.1_universal.app.tar.gz.sig": "sig-app",
    });
    const { platforms } = latestJson(readBundles(dir), OPTIONS);
    expect(platforms["darwin-x86_64"]).toEqual(platforms["darwin-aarch64"]);
    expect(platforms["darwin-x86_64-app"]).toEqual(platforms["darwin-aarch64"]);
    expect(platforms["darwin-aarch64-app"].signature).toBe("sig-app");
  });

  it("refuses an unsigned bundle the updater installs, a missing default and a duplicate", () => {
    writeFiles(without("RIM_0.0.1_amd64.deb.sig"));
    expect(() => latestJson(readBundles(dir), OPTIONS)).toThrow(
      "RIM_0.0.1_amd64.deb: no .sig file",
    );
    writeFiles({ "RIM_0.0.1_amd64.deb.sig": "sig-deb" });
    rmSync(join(dir, "RIM_0.0.1_x64-setup.exe"));
    rmSync(join(dir, "RIM_0.0.1_x64-setup.exe.sig"));
    expect(() => latestJson(readBundles(dir), OPTIONS)).toThrow(
      "no default bundle for windows-x86_64",
    );
    writeFiles({ "RIM_0.0.2_amd64.AppImage": "a", "RIM_0.0.2_amd64.AppImage.sig": "s" });
    expect(() => latestJson(readBundles(dir), OPTIONS)).toThrow(
      "linux-x86_64-appimage: two bundles",
    );
  });
});

describe("sha256sums and downloadTable", () => {
  it("lists every bundle and the notices in sha256sum format, and the bundles as a table", () => {
    writeFiles(RELEASE_FILES);
    const bundles = readBundles(dir);
    const sums = sha256sums([...bundles, readNotices(dir)]);
    expect(sums.trim().split("\n")).toHaveLength(6);
    expect(
      execFileSync("sha256sum", ["-c", "-"], {
        cwd: dir,
        input: sums,
        encoding: "utf8",
        env: { ...process.env, LC_ALL: "C" },
      }),
    ).toContain("RIM_0.0.1_x64_en-US.msi: OK\nTHIRD-PARTY-LICENSES.txt: OK");
    expect(downloadTable(bundles, OPTIONS)).toBe(`| File | Platform | Size |
| --- | --- | --- |
| [RIM_0.0.1_amd64.AppImage](https://github.com/rim-platform/rim-ui/releases/download/v0.0.1/RIM_0.0.1_amd64.AppImage) | Linux x86_64 (AppImage, any distribution) | 0.0 MB |
| [RIM_0.0.1_amd64.deb](https://github.com/rim-platform/rim-ui/releases/download/v0.0.1/RIM_0.0.1_amd64.deb) | Linux x86_64 (Debian, Ubuntu) | 0.0 MB |
| [RIM-0.0.1-1.x86_64.rpm](https://github.com/rim-platform/rim-ui/releases/download/v0.0.1/RIM-0.0.1-1.x86_64.rpm) | Linux x86_64 (Fedora, openSUSE) | 0.0 MB |
| [RIM_0.0.1_x64-setup.exe](https://github.com/rim-platform/rim-ui/releases/download/v0.0.1/RIM_0.0.1_x64-setup.exe) | Windows x86_64 (installer) | 0.0 MB |
| [RIM_0.0.1_x64_en-US.msi](https://github.com/rim-platform/rim-ui/releases/download/v0.0.1/RIM_0.0.1_x64_en-US.msi) | Windows x86_64 (MSI, for managed installs) | 0.0 MB |
`);
  });
});

describe("the command", () => {
  it("writes latest.json and SHA256SUMS and prints the table", () => {
    writeFiles(RELEASE_FILES);
    const out = execFileSync("node", [SCRIPT.pathname, dir, "0.0.1", REPO], { encoding: "utf8" });
    expect(out).toMatch(/^\| File \| Platform \| Size \|/);
    const latest = JSON.parse(readFileSync(join(dir, "latest.json"), "utf8"));
    expect(latest.pub_date).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(Object.keys(latest.platforms)).toHaveLength(7);
    expect(readFileSync(join(dir, "SHA256SUMS"), "utf8")).toBe(
      sha256sums([...readBundles(dir), readNotices(dir)]),
    );
  });

  it("fails with the reason and without writing", () => {
    writeFiles(without("RIM_0.0.1_amd64.AppImage.sig"));
    let error;
    try {
      execFileSync("node", [SCRIPT.pathname, dir, "0.0.1", REPO], { stdio: "pipe" });
    } catch (e) {
      error = e;
    }
    expect(error.status).toBe(1);
    expect(error.stderr.toString()).toContain("RIM_0.0.1_amd64.AppImage: no .sig file");
    expect(() => readFileSync(join(dir, "latest.json"))).toThrow();
  });
});
