import { describe, expect, it } from "vitest";

import {
  BundleError,
  MAX_BUNDLE_BYTES,
  findDuplicateKey,
  readBundle,
  sha256Hex,
  writeBundle,
  type BundleFile,
} from "./bundle";
import { HELLO_WEB_BUNDLE_SHA256, HELLO_WEB_MAIN, HELLO_WEB_MANIFEST } from "./testing/helloWeb";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function file(path: string, text: string): BundleFile {
  return { path, bytes: encoder.encode(text) };
}

const helloWeb = () => [
  file("rim-plugin.json", HELLO_WEB_MANIFEST),
  file("main.mjs", HELLO_WEB_MAIN),
];

function doc(files: string): Uint8Array {
  return encoder.encode(`{"format":"rim-plugin-bundle","v":1,"files":${files}}`);
}

const manifestEntry = () =>
  `{"path":"rim-plugin.json","text":${JSON.stringify(HELLO_WEB_MANIFEST)}}`;

function refusal(bytes: Uint8Array): string {
  try {
    readBundle(bytes);
  } catch (error) {
    expect(error).toBeInstanceOf(BundleError);
    return (error as Error).message;
  }
  throw new Error("the bundle was accepted");
}

describe("bundles", () => {
  it("writes appendix A byte for byte", async () => {
    expect(encoder.encode(HELLO_WEB_MAIN).length).toBe(1101);
    expect(encoder.encode(HELLO_WEB_MANIFEST).length).toBe(306);
    const bytes = writeBundle(helloWeb());
    expect(bytes.length).toBe(1605);
    expect(await sha256Hex(bytes)).toBe(HELLO_WEB_BUNDLE_SHA256);
    expect(decoder.decode(bytes)).toBe(
      `{"format":"rim-plugin-bundle","v":1,"files":[{"path":"main.mjs","text":${JSON.stringify(HELLO_WEB_MAIN)}},{"path":"rim-plugin.json","text":${JSON.stringify(HELLO_WEB_MANIFEST)}}]}`,
    );
    const bundle = readBundle(bytes);
    expect(bundle.manifest.plugin_id).toBe("dev.example.hello-web");
    expect(bundle.manifestText).toBe(HELLO_WEB_MANIFEST);
    expect(decoder.decode(bundle.files[0].bytes)).toBe(HELLO_WEB_MAIN);
  });

  it("keeps binary files as base64", () => {
    const files = [
      ...helloWeb(),
      { path: "panels/main/icon.png", bytes: new Uint8Array([0x89, 0x50, 0xff, 0]) },
    ];
    const bytes = writeBundle(files);
    expect(decoder.decode(bytes)).toContain('"base64":"iVD/AA=="');
    expect(Array.from(readBundle(bytes).files[1].bytes)).toEqual([0x89, 0x50, 0xff, 0]);
  });

  it("refuses unsorted and duplicate paths", () => {
    const main = '{"path":"main.mjs","text":"x"}';
    expect(refusal(doc(`[${manifestEntry()},${main}]`))).toContain("sorted");
    expect(refusal(doc(`[${main},${main},${manifestEntry()}]`))).toContain("sorted and unique");
  });

  it("refuses paths with .., a dot segment or other characters", () => {
    for (const path of ["../main.mjs", "panels/./a.js", "panels/.hidden", "a//b", "/abs", "a b"]) {
      const files = `[{"path":"main.mjs","text":"x"},{"path":"${path}","text":"x"},${manifestEntry()}]`;
      expect(refusal(doc(files)), path).toContain("not a valid bundle path");
    }
  });

  it("refuses an entry with both text and base64, or neither", () => {
    expect(
      refusal(doc(`[{"path":"main.mjs","text":"x","base64":"eA=="},${manifestEntry()}]`)),
    ).toContain("exactly one");
    expect(refusal(doc(`[{"path":"main.mjs"},${manifestEntry()}]`))).toContain("exactly one");
    expect(
      refusal(doc(`[{"path":"main.mjs","text":null,"base64":"eA=="},${manifestEntry()}]`)),
    ).toContain("main.mjs");
    expect(refusal(doc(`[{"path":"main.mjs","base64":"eA="},${manifestEntry()}]`))).toContain(
      "base64",
    );
  });

  it("refuses a bundle without its manifest or entrypoint", () => {
    expect(refusal(doc('[{"path":"main.mjs","text":"x"}]'))).toContain(
      "rim-plugin.json is missing",
    );
    expect(refusal(doc(`[${manifestEntry()}]`))).toContain("entrypoint `main.mjs` is missing");
  });

  it("refuses a web bundle file outside panels/", () => {
    expect(refusal(writeBundle([...helloWeb(), file("notes.txt", "x")]))).toContain(
      "outside panels/",
    );
    expect(() =>
      readBundle(writeBundle([...helloWeb(), file("panels/main/index.html", "<p>")])),
    ).not.toThrow();
  });

  it("refuses a web entrypoint with a #! line", () => {
    const files = [
      file("rim-plugin.json", HELLO_WEB_MANIFEST),
      file("main.mjs", "#!/usr/bin/env node\n"),
    ];
    expect(refusal(writeBundle(files))).toContain("#!");
  });

  it("refuses 8 MiB plus one byte", () => {
    const bundle = writeBundle(helloWeb());
    const padded = new Uint8Array(MAX_BUNDLE_BYTES + 1).fill(0x20);
    padded.set(bundle);
    expect(refusal(padded)).toContain("over the");
    expect(() => readBundle(padded.subarray(0, MAX_BUNDLE_BYTES))).not.toThrow();
  });

  it("refuses unknown and duplicate fields at any level", () => {
    expect(
      refusal(encoder.encode('{"format":"rim-plugin-bundle","v":1,"files":[],"signed":true}')),
    ).toContain("unknown field");
    expect(
      refusal(doc(`[{"path":"main.mjs","text":"x","mode":493},${manifestEntry()}]`)),
    ).toContain("unknown field");
    expect(
      refusal(encoder.encode('{"format":"rim-plugin-bundle","v":1,"v":1,"files":[]}')),
    ).toContain("duplicate field `v`");
    expect(refusal(encoder.encode('{"format":"zip","v":1,"files":[]}'))).toContain("format");
    expect(refusal(encoder.encode('{"format":"rim-plugin-bundle","v":2,"files":[]}'))).toContain(
      "version",
    );
    expect(refusal(doc("[]"))).toContain("1 to 256");
    expect(refusal(encoder.encode('﻿{"format":"rim-plugin-bundle","v":1,"files":[]}'))).toContain(
      "not a plugin bundle",
    );
  });
});

describe("findDuplicateKey", () => {
  it("finds a repeated key in any object, ignoring strings and arrays", () => {
    expect(findDuplicateKey('{"a":1,"b":{"c":1,"c":2}}')).toBe("c");
    expect(findDuplicateKey('{"a":"\\"a\\"","b":["a","a"],"c":{"a":1}}')).toBeNull();
    expect(findDuplicateKey('[{"a":1},{"a":2}]')).toBeNull();
    expect(findDuplicateKey('{"\\u0061":1,"a":2}')).toBe("a");
  });
});
