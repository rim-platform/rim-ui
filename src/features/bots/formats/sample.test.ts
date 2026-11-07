import { describe, expect, it } from "vitest";

import {
  MAX_SAMPLE_PATHS,
  eventOf,
  headersToLines,
  isFormEncoded,
  linesToHeaders,
  readableBody,
  samplePaths,
} from "./sample";

describe("a sample", () => {
  it("offers the paths a format can name, list indexes included", () => {
    const body = JSON.stringify({
      status: "firing",
      alerts: [{ labels: { alertname: "Disk" } }],
      "has space": 1,
    });
    expect(samplePaths(body)).toEqual([
      "status",
      "alerts",
      "alerts.0",
      "alerts.0.labels",
      "alerts.0.labels.alertname",
    ]);
  });

  it("offers at most 500 paths, and none for a body that isn't JSON", () => {
    const wide = Object.fromEntries(Array.from({ length: 800 }, (_, i) => [`k${i}`, i]));
    expect(samplePaths(JSON.stringify(wide))).toHaveLength(MAX_SAMPLE_PATHS);
    expect(samplePaths("payload=%7B%7D")).toEqual([]);
  });

  it("reads headers as Name: value lines and back", () => {
    const headers = [
      { name: "X-GitHub-Event", value: "push" },
      { name: "X-Other", value: "a: b" },
    ];
    expect(linesToHeaders(headersToLines(headers))).toEqual(headers);
    expect(linesToHeaders("no colon\n: no name\nX-A:  1 ")).toEqual([{ name: "X-A", value: "1" }]);
  });

  it("knows a form-encoded body, an event header and a JSON body to indent", () => {
    expect(isFormEncoded("application/x-www-form-urlencoded; charset=utf-8")).toBe(true);
    expect(isFormEncoded("application/json")).toBe(false);
    expect(eventOf([{ name: "x-github-event", value: "ping" }])).toBe("ping");
    expect(eventOf([{ name: "x-other", value: "1" }])).toBeNull();
    expect(readableBody('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(readableBody("not json")).toBe("not json");
  });
});
