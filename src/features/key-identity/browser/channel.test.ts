import { describe, expect, it } from "vitest";

import { fromHex, hex } from "../../../test/ed25519";
import { b64, unb64 } from "./bytes";
import {
  aad,
  answerCertificate,
  fingerprint,
  hkdfParams,
  NOT_OPENED,
  offerPlaintext,
  open,
  parseLinkCode,
  seal,
  sealWithNonce,
  type Sealed,
} from "./channel";

// Known-answer vectors from device-linking-v1 appendix A.
const LINK_ID = "AAECAwQFBgcICQoLDA0ODw";
const SECRET = "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8";
const ENDPOINT = "http://localhost:8080/api";
const CODE = `rim-link:1:${LINK_ID}:${SECRET}:${ENDPOINT}`;
const K_OFFER = "6dff67bf777c3cf073ebc0f8810dae7535d3bdb59c9178183441db3768212fba";
const K_ANSWER = "d6ec24d3f4380cb2ca50865f95a37f3e6b0ab9c2d74ee31d605768abe6bf56e1";
const OFFER_AAD =
  "72696d2e6465766963652d6c696e6b2e7631006f666665720041414543417751464267634943516f4c4441304f4477";
const ANSWER_AAD =
  "72696d2e6465766963652d6c696e6b2e763100616e737765720041414543417751464267634943516f4c4441304f4477";
const OFFER_NONCE = "QEFCQ0RFRkdISUpL";
const ANSWER_NONCE = "UFFSU1RVVldYWVpb";
const FINGERPRINT = "QSFX-VHMA";
const OFFER = `{"v":1,"type":"link-offer","deviceId":"00000000-0000-0000-0000-000000000001","deviceKey":"ed25519:IIKL9cW9ystoSGMzbCAvtVmdpIvlWWYVdCFwcFvsqfc","name":"Laptop","platform":"desktop","statementVersion":2}`;
const OFFER_CIPHERTEXT =
  "J8-HezTgXKj9OyT7HMBA1zjjB4ZTJEJkqjh4skQfSya0Sxe6uk9qWLSzUqUAQ7QrC4ZIEYlO_dsskNkfhQ_iEVXyyUkGmH2j1gqSNpQTetjmsgmQEXUbEsSs8ciJPmD_o_T8zR_R7k-rjthHmMQYHVfwslbojzQhR7wXQiUJfZtIDm5bfx9wYmPPjvmcA9RYQnV6_3GRGoFbsLE9fGt4mRlidnXDiOweblWqdi0dARTNJHJL7DDAMwmqGHiEIcAVTVu7B4SiHFPrTmVBclEOQUB5SxXIsO1wsQ";
const ANSWER = `{"v":1,"type":"link-answer","certificate":{"payload":"{\\"v\\":2,\\"type\\":\\"device\\",\\"principalId\\":\\"rimp1_txDLbnipi5i3kCJtJwBOUixzv_MY8OnU0mcy--Tyje0\\",\\"deviceId\\":\\"00000000-0000-0000-0000-000000000001\\",\\"deviceKey\\":\\"ed25519:IIKL9cW9ystoSGMzbCAvtVmdpIvlWWYVdCFwcFvsqfc\\",\\"name\\":\\"Laptop\\",\\"keySeq\\":0,\\"issuedAt\\":\\"2026-10-09T00:00:00Z\\"}","signature":"ed25519:0HjRzn6gQ2q-vCHSkdOPK2ykGGBUpW2fYdDuEdTzf6OxsWzjXeNNpRSVgzPxOEfbYzZ9o9DWqp4NxcTEDhOaDA"}}`;
const ANSWER_CIPHERTEXT =
  "vkDrDIh3nkBRDHroeH_tmxnHXtoMzfo4grqtAiBG46z7xMsAlJDtvvExm51M7w7G7oglt9YXamu3_qjKYYDPA7b_xGvbPvWGkw98Hc91oL2qQvVYz0MSwIWu5R_FyFwN0SIVdph0xJxLBdXq3E3-iKFd4fdfLRdZvRi7qMMTY7wW8DMw2ItevB1tV2xfMF2_WpZNSUvPuJUF9l8VIdtiIHO1V94Sx-ombzLAvfndFHJfxKhsDwxPB9YSaKoaIvKPZrI_6Z0Mzwdn7RAyepsgjrOz4wDnoEWv5eFOO1zU4RpZvRwOmlhJ2NKwLsG87fEtw16kB3g2qMqvwGLWrQ4VuqygY3JucPE0Gu2H-dkxLEYrEuPMbGxMzD2ROIAlZFKljdgj8zGLrYbkLml1Jh-rJijDswN0ktaw-dCCqd0-Pbt4nXvBKGTV5ZuDJ1W-nIMYs9Py81klr5gBOypP8A3In4OFi7ePsu2FOnZE-LRYfaLeYv2PCPKCFaZnCjJS0asVa-UFXHhmz2sWxVwEi1OnENi11C4bweM6a_9ydUHi4w4QMBkZpfHCyondEdgCtxyq8xZXPsEP6_JX007Y9jm9gGQ8JExrsviYRMpeWFT1pVJ2HJJfbkrHrF1Fq7c";
const CERTIFICATE = {
  payload: `{"v":2,"type":"device","principalId":"rimp1_txDLbnipi5i3kCJtJwBOUixzv_MY8OnU0mcy--Tyje0","deviceId":"00000000-0000-0000-0000-000000000001","deviceKey":"ed25519:IIKL9cW9ystoSGMzbCAvtVmdpIvlWWYVdCFwcFvsqfc","name":"Laptop","keySeq":0,"issuedAt":"2026-10-09T00:00:00Z"}`,
  signature:
    "ed25519:0HjRzn6gQ2q-vCHSkdOPK2ykGGBUpW2fYdDuEdTzf6OxsWzjXeNNpRSVgzPxOEfbYzZ9o9DWqp4NxcTEDhOaDA",
};

const code = () => parseLinkCode(CODE);
const utf8 = (text: string) => new Uint8Array(new TextEncoder().encode(text));
const sealed = (nonce: string, ciphertext: string): Sealed => ({ nonce, ciphertext });

async function rawKey(direction: "offer" | "answer"): Promise<string> {
  const c = code();
  const ikm = await crypto.subtle.importKey("raw", c.secret, "HKDF", false, ["deriveBits"]);
  return hex(new Uint8Array(await crypto.subtle.deriveBits(hkdfParams(c, direction), ikm, 256)));
}

function flip(text: string, at: number): string {
  const bytes = unb64(text) as Uint8Array;
  bytes[at] ^= 1;
  return b64(bytes);
}

describe("device-linking appendix A", () => {
  it("the code, the channel keys and the AADs", async () => {
    const c = code();
    expect(hex(c.linkId)).toBe("000102030405060708090a0b0c0d0e0f");
    expect(c.linkIdText).toBe(LINK_ID);
    expect(b64(c.secret)).toBe(SECRET);
    expect(c.endpoint).toBe(ENDPOINT);
    expect(CODE.length).toBe(103);
    expect(await rawKey("offer")).toBe(K_OFFER);
    expect(await rawKey("answer")).toBe(K_ANSWER);
    expect(hex(aad(LINK_ID, "offer"))).toBe(OFFER_AAD);
    expect(hex(aad(LINK_ID, "answer"))).toBe(ANSWER_AAD);
  });

  it("the offer seals, opens and fingerprints byte for byte", async () => {
    const plaintext = offerPlaintext({
      deviceId: "00000000-0000-0000-0000-000000000001",
      deviceKey: "ed25519:IIKL9cW9ystoSGMzbCAvtVmdpIvlWWYVdCFwcFvsqfc",
      name: "Laptop",
      platform: "desktop",
      statementVersion: 2,
    });
    expect(new TextDecoder().decode(plaintext)).toBe(OFFER);
    expect(plaintext.length).toBe(201);
    const offer = await sealWithNonce(code(), "offer", plaintext, unb64(OFFER_NONCE) as Uint8Array);
    expect(offer).toEqual(sealed(OFFER_NONCE, OFFER_CIPHERTEXT));
    const bytes = unb64(OFFER_CIPHERTEXT) as Uint8Array;
    expect(bytes.length).toBe(217);
    expect(hex(bytes.subarray(201))).toBe("4e654172510e4140794b15c8b0ed70b1");

    const opened = await open(code(), "offer", offer);
    expect(new TextDecoder().decode(opened)).toBe(OFFER);
    expect(await fingerprint(opened)).toBe(FINGERPRINT);
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new Uint8Array([...utf8("rim.device-link.v1 fingerprint\0"), ...utf8(OFFER)]),
    );
    expect(hex(new Uint8Array(digest))).toBe(
      "848b7a9d80a01b87adceab1630b57a452359598c53e4326382d7a236e3ca8629",
    );
  });

  it("the answer seals and opens byte for byte", async () => {
    const answer = await sealWithNonce(
      code(),
      "answer",
      utf8(ANSWER),
      unb64(ANSWER_NONCE) as Uint8Array,
    );
    expect(answer).toEqual(sealed(ANSWER_NONCE, ANSWER_CIPHERTEXT));
    const bytes = unb64(ANSWER_CIPHERTEXT) as Uint8Array;
    expect(bytes.length).toBe(476);
    expect(utf8(ANSWER).length).toBe(460);
    expect(hex(bytes.subarray(460))).toBe("54f5a552761c925f6e4ac7ac5d45abb7");

    const opened = await open(code(), "answer", answer);
    expect(new TextDecoder().decode(opened)).toBe(ANSWER);
    expect(answerCertificate(opened)).toEqual(CERTIFICATE);
  });

  it("a web offer differs only in its platform", async () => {
    const web = offerPlaintext({
      deviceId: "00000000-0000-0000-0000-000000000001",
      deviceKey: "ed25519:IIKL9cW9ystoSGMzbCAvtVmdpIvlWWYVdCFwcFvsqfc",
      name: "Laptop",
      platform: "web",
      statementVersion: 2,
    });
    expect(new TextDecoder().decode(web)).toBe(OFFER.replace(`"desktop"`, `"web"`));
  });
});

describe("the channel", () => {
  it("never opens an offer as an answer or under another link", async () => {
    const offer = sealed(OFFER_NONCE, OFFER_CIPHERTEXT);
    await expect(open(code(), "answer", offer)).rejects.toThrow(NOT_OPENED);
    await expect(open(code(), "offer", sealed(ANSWER_NONCE, ANSWER_CIPHERTEXT))).rejects.toThrow(
      NOT_OPENED,
    );
    const otherLink = parseLinkCode(CODE.replace(LINK_ID, "AAECAwQFBgcICQoLDA0OEA"));
    await expect(open(otherLink, "offer", offer)).rejects.toThrow(NOT_OPENED);
    const otherSecret = parseLinkCode(CODE.replace(SECRET, b64(new Uint8Array(32).fill(7))));
    await expect(open(otherSecret, "offer", offer)).rejects.toThrow(NOT_OPENED);
    // The endpoint is not part of the channel.
    const elsewhere = parseLinkCode(CODE.replace(ENDPOINT, "https://rim.example"));
    await expect(open(elsewhere, "offer", offer)).resolves.toBeDefined();
  });

  it("refuses a flipped nonce, tag, ciphertext or AAD byte, and malformed fields", async () => {
    const last = (unb64(OFFER_CIPHERTEXT) as Uint8Array).length - 1;
    for (const bad of [
      sealed(flip(OFFER_NONCE, 0), OFFER_CIPHERTEXT),
      sealed(OFFER_NONCE, flip(OFFER_CIPHERTEXT, 0)),
      sealed(OFFER_NONCE, flip(OFFER_CIPHERTEXT, last)),
      sealed("QEFCQ0RFRkdISUo", OFFER_CIPHERTEXT),
      sealed(OFFER_NONCE, "AAAA"),
      sealed(OFFER_NONCE, "not base64!"),
      sealed(`${OFFER_NONCE}=`, OFFER_CIPHERTEXT),
    ]) {
      await expect(open(code(), "offer", bad)).rejects.toThrow(NOT_OPENED);
    }
    // The same key and nonce under a changed AAD.
    const c = code();
    const ikm = await crypto.subtle.importKey("raw", c.secret, "HKDF", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
      hkdfParams(c, "offer"),
      ikm,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"],
    );
    const changed = aad(LINK_ID, "offer");
    changed[changed.length - 1] ^= 1;
    await expect(
      crypto.subtle.decrypt(
        { name: "AES-GCM", iv: unb64(OFFER_NONCE) as Uint8Array, additionalData: changed },
        key,
        unb64(OFFER_CIPHERTEXT) as Uint8Array,
      ),
    ).rejects.toThrow();
  });

  it("seals with a fresh nonce that opens again, and refuses empty or oversized plaintexts", async () => {
    const a = await seal(code(), "offer", utf8(OFFER));
    const b = await seal(code(), "offer", utf8(OFFER));
    expect(a.nonce).not.toBe(b.nonce);
    expect(new TextDecoder().decode(await open(code(), "offer", a))).toBe(OFFER);
    await expect(seal(code(), "offer", new Uint8Array(0))).rejects.toThrow("too large");
    await expect(seal(code(), "offer", new Uint8Array(16 * 1024 + 1))).rejects.toThrow("too large");
    await expect(seal(code(), "answer", new Uint8Array(64 * 1024))).resolves.toBeDefined();
  });

  it("reads answers strictly", () => {
    const read = (text: string) => () => answerCertificate(utf8(text));
    expect(read(ANSWER)()).toEqual(CERTIFICATE);
    expect(read(ANSWER.replace(`"v":1,`, `"v":1,"extra":true,`))).toThrow(NOT_OPENED);
    expect(read(ANSWER.replace(`"signature":`, `"extra":1,"signature":`))).toThrow(NOT_OPENED);
    expect(read(ANSWER.replace(`"v":1`, `"v":2`))).toThrow(NOT_OPENED);
    expect(read(ANSWER.replace("link-answer", "link-offer"))).toThrow(NOT_OPENED);
    expect(read(OFFER)).toThrow(NOT_OPENED);
    expect(read("not json")).toThrow(NOT_OPENED);
    expect(() => answerCertificate(fromHex("ff"))).toThrow(NOT_OPENED);
  });
});

describe("the code reader", () => {
  const message = (text: string) => {
    try {
      parseLinkCode(text);
      return "parsed";
    } catch (err) {
      return (err as Error).message;
    }
  };

  it("removes exactly TAB, LF, FF, CR and SPACE, and ignores the scheme's case", () => {
    const wrapped = `\t${CODE.slice(0, 30)}\n${CODE.slice(30, 60)}\f${CODE.slice(60, 80)}\r ${CODE.slice(80)} `;
    expect(parseLinkCode(wrapped)).toEqual(code());
    expect(parseLinkCode(CODE.replace("rim-link:", "RIM-Link:"))).toEqual(code());
    // VT, NBSP and other Unicode spaces are not ASCII whitespace.
    for (const space of ["\v", " ", " ", "　"]) {
      expect(message(`${CODE.slice(0, 40)}${space}${CODE.slice(40)}`)).toContain(
        "not a device link code",
      );
    }
    // Only ASCII letters fold: the Kelvin sign is not a `k`.
    expect(message(CODE.replace("rim-link:", "rim-linK:"))).toContain("not a device link code");
  });

  it("keeps the endpoint's own colons", () => {
    expect(parseLinkCode(CODE.replace(ENDPOINT, "https://[::1]:8443/api")).endpoint).toBe(
      "https://[::1]:8443/api",
    );
  });

  it("tells a newer version from something that is not a code", () => {
    expect(message(CODE.replace(":1:", ":2:"))).toBe(
      "this code was made by a newer app; update this device",
    );
    for (const version of [":x:", ":0:", ":01:", "::", ":+1:", ":99999999999:"]) {
      expect(message(CODE.replace(":1:", version))).toContain("not a device link code");
    }
    expect(message("rim-link:1")).toContain("not a device link code");
    expect(message(CODE.replace("rim-link:", "rim-lnk:"))).toContain("not a device link code");
  });

  it("takes 334 characters and refuses 335", () => {
    const at = (length: number) => CODE.replace(ENDPOINT, `https://${"a".repeat(length - 78 - 8)}`);
    expect(at(334).length).toBe(334);
    expect(message(at(334))).toBe("parsed");
    expect(at(335).length).toBe(335);
    expect(message(at(335))).toContain("not a device link code");
  });

  it("decodes the link id and secret strictly", () => {
    for (const bad of [
      CODE.replace(LINK_ID, `${LINK_ID}==`),
      CODE.replace(LINK_ID, LINK_ID.slice(0, 21)),
      CODE.replace(LINK_ID, "AAECAwQFBgcICQoLDA0ODx"),
      CODE.replace(SECRET, SECRET.slice(0, 42)),
      CODE.replace(SECRET, `${SECRET}=`),
      CODE.replace(SECRET, `${SECRET.slice(0, 42)}9`),
    ]) {
      expect(message(bad)).toContain("not a device link code");
    }
  });

  it("checks the endpoint's charset and scheme", () => {
    for (const endpoint of [
      "http://localhost:8080/api?x",
      "http://localhost:8080/api#x",
      "http://user@localhost:8080/api",
      "ftp://localhost/api",
      "localhost:8080/api",
      "http://localhost:8080/ä",
      "",
    ]) {
      expect(message(CODE.replace(ENDPOINT, endpoint)), endpoint).toContain(
        "not a device link code",
      );
    }
  });
});
