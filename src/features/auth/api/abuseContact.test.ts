import { describe, expect, it } from "vitest";

import { abuseContactHref } from "./abuseContact";

describe("abuseContactHref", () => {
  it("links an https URL as itself and anything else as an email address", () => {
    expect(abuseContactHref("https://acme.example/report")).toBe("https://acme.example/report");
    expect(abuseContactHref("abuse@acme.example")).toBe("mailto:abuse@acme.example");
    expect(abuseContactHref("javascript:alert(1)")).toBe("mailto:javascript:alert(1)");
    expect(abuseContactHref("http://acme.example")).toBe("mailto:http://acme.example");
  });
});
