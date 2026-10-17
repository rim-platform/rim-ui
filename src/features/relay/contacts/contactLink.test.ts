import { describe, expect, it } from "vitest";

import {
  ContactLinkError,
  formatContactLink,
  MAX_CONTACT_LINK_LEN,
  parseContactLink,
  validRelayUrl,
} from "./contactLink";
import { principalFingerprint } from "./fingerprint";

const PRINCIPAL = "rimp1_txDLbnipi5i3kCJtJwBOUixzv_MY8OnU0mcy--Tyje0";

describe("contact links", () => {
  it("formats and reads back a link, keeping the URL's colons", () => {
    const link = formatContactLink({
      principalId: PRINCIPAL,
      relayUrl: "https://relay.example:8443",
    });
    expect(link).toBe(`rim-contact:1:${PRINCIPAL}:https://relay.example:8443`);
    expect(parseContactLink(link)).toEqual({
      principalId: PRINCIPAL,
      relayUrl: "https://relay.example:8443",
    });
  });

  it("reads a link wrapped by a chat app, with the scheme in capitals", () => {
    const wrapped = `RIM-CONTACT:1:${PRINCIPAL.slice(0, 20)}\n ${PRINCIPAL.slice(20)}:https://relay.example`;
    expect(parseContactLink(wrapped).principalId).toBe(PRINCIPAL);
  });

  it("refuses malformed links", () => {
    const bad = [
      `rim-contact:0:${PRINCIPAL}:https://relay.example`,
      `rim-contact:01:${PRINCIPAL}:https://relay.example`,
      `rim-contact:1:rimp1_short:https://relay.example`,
      `rim-contact:1:${PRINCIPAL}:ftp://relay.example`,
      `rim-contact:1:${PRINCIPAL}:https://user@relay.example`,
      `rim-contact:1:${PRINCIPAL}:https://relay.example/?x`,
      `rim-link:1:${PRINCIPAL}:https://relay.example`,
      `rim-contact:1:${PRINCIPAL}:https://${"a".repeat(MAX_CONTACT_LINK_LEN)}`,
    ];
    for (const text of bad) expect(() => parseContactLink(text)).toThrow(ContactLinkError);
    expect(() => parseContactLink(`rim-contact:2:${PRINCIPAL}:https://relay.example`)).toThrow(
      /newer app/,
    );
  });

  it("checks relay URLs as device-link endpoints", () => {
    expect(validRelayUrl("http://localhost:8080")).toBe(true);
    expect(validRelayUrl("https://relay.example/#x")).toBe(false);
    expect(validRelayUrl("https://relay example")).toBe(false);
  });
});

describe("principalFingerprint", () => {
  it("is four groups of four base32 characters, the same for the same account", async () => {
    const fingerprint = await principalFingerprint(PRINCIPAL);
    expect(fingerprint).toMatch(/^[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/);
    expect(await principalFingerprint(PRINCIPAL)).toBe(fingerprint);
    expect(await principalFingerprint(PRINCIPAL.replace("e0", "e1"))).not.toBe(fingerprint);
  });
});
