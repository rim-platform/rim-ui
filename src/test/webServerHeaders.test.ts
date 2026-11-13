import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dockerfile = readFileSync(`${import.meta.dirname}/../../Dockerfile`, "utf8");
const nginx = dockerfile.slice(dockerfile.indexOf("server {"), dockerfile.indexOf("\nNGINX"));
const headers = dockerfile.slice(
  dockerfile.indexOf("rim-security-headers.conf <<"),
  dockerfile.lastIndexOf("\nHEADERS"),
);

/** The text of each `location` block of the web image's nginx server. */
function locations(): { name: string; body: string }[] {
  return [...nginx.matchAll(/location ([^{]+)\{([\s\S]*?)\n {4}\}/g)].map((m) => ({
    name: m[1].trim(),
    body: m[2],
  }));
}

describe("the web image's nginx headers", () => {
  it("sends HSTS and a same-origin opener policy with the app's headers", () => {
    expect(headers).toContain('add_header Strict-Transport-Security "max-age=31536000" always;');
    expect(headers).not.toMatch(/preload|includeSubDomains/);
    expect(headers).toContain('add_header Cross-Origin-Opener-Policy "same-origin" always;');
  });

  it("gives every location that sets its own headers the security headers too", () => {
    const own = locations().filter((l) => l.body.includes("add_header"));
    expect(own.map((l) => l.name)).toContain("/assets/");
    for (const location of own) {
      const shared = location.body.includes("include /etc/nginx/rim-security-headers.conf;");
      const hsts = location.body.includes("Strict-Transport-Security");
      const nosniff = location.body.includes("X-Content-Type-Options");
      if (location.name === "= /health") continue;
      expect(shared || (hsts && nosniff), location.name).toBe(true);
    }
    expect(nginx).toContain("include /etc/nginx/rim-security-headers.conf;");
  });
});
