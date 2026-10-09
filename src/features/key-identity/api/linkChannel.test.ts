import { describe, expect, it } from "vitest";

import {
  audienceOf,
  fingerprint,
  fromB64url,
  offerJson,
  open,
  openChannel,
  parseLinkCode,
  readAnswer,
  sameEndpoint,
  seal,
  uuidV7,
} from "./linkChannel";

// Appendix A of rim-server/docs/specs/device-linking-v1.md.
const LINK_ID = "AAECAwQFBgcICQoLDA0ODw";
const SECRET = "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8";
const CODE = `rim-link:1:${LINK_ID}:${SECRET}:http://localhost:8080/api`;
const OFFER_PLAINTEXT =
  '{"v":1,"type":"link-offer","deviceId":"00000000-0000-0000-0000-000000000001","deviceKey":"ed25519:IIKL9cW9ystoSGMzbCAvtVmdpIvlWWYVdCFwcFvsqfc","name":"Laptop","platform":"desktop","statementVersion":2}';
const OFFER_CIPHERTEXT =
  "J8-HezTgXKj9OyT7HMBA1zjjB4ZTJEJkqjh4skQfSya0Sxe6uk9qWLSzUqUAQ7QrC4ZIEYlO_dsskNkfhQ_iEVXyyUkGmH2j1gqSNpQTetjmsgmQEXUbEsSs8ciJPmD_o_T8zR_R7k-rjthHmMQYHVfwslbojzQhR7wXQiUJfZtIDm5bfx9wYmPPjvmcA9RYQnV6_3GRGoFbsLE9fGt4mRlidnXDiOweblWqdi0dARTNJHJL7DDAMwmqGHiEIcAVTVu7B4SiHFPrTmVBclEOQUB5SxXIsO1wsQ";
const CERT_PAYLOAD =
  '{"v":2,"type":"device","principalId":"rimp1_txDLbnipi5i3kCJtJwBOUixzv_MY8OnU0mcy--Tyje0","deviceId":"00000000-0000-0000-0000-000000000001","deviceKey":"ed25519:IIKL9cW9ystoSGMzbCAvtVmdpIvlWWYVdCFwcFvsqfc","name":"Laptop","keySeq":0,"issuedAt":"2026-10-09T00:00:00Z"}';
const CERT_SIG =
  "ed25519:0HjRzn6gQ2q-vCHSkdOPK2ykGGBUpW2fYdDuEdTzf6OxsWzjXeNNpRSVgzPxOEfbYzZ9o9DWqp4NxcTEDhOaDA";
const ANSWER_PLAINTEXT = JSON.stringify({
  v: 1,
  type: "link-answer",
  certificate: { payload: CERT_PAYLOAD, signature: CERT_SIG },
});
const ANSWER_CIPHERTEXT =
  "vkDrDIh3nkBRDHroeH_tmxnHXtoMzfo4grqtAiBG46z7xMsAlJDtvvExm51M7w7G7oglt9YXamu3_qjKYYDPA7b_xGvbPvWGkw98Hc91oL2qQvVYz0MSwIWu5R_FyFwN0SIVdph0xJxLBdXq3E3-iKFd4fdfLRdZvRi7qMMTY7wW8DMw2ItevB1tV2xfMF2_WpZNSUvPuJUF9l8VIdtiIHO1V94Sx-ombzLAvfndFHJfxKhsDwxPB9YSaKoaIvKPZrI_6Z0Mzwdn7RAyepsgjrOz4wDnoEWv5eFOO1zU4RpZvRwOmlhJ2NKwLsG87fEtw16kB3g2qMqvwGLWrQ4VuqygY3JucPE0Gu2H-dkxLEYrEuPMbGxMzD2ROIAlZFKljdgj8zGLrYbkLml1Jh-rJijDswN0ktaw-dCCqd0-Pbt4nXvBKGTV5ZuDJ1W-nIMYs9Py81klr5gBOypP8A3In4OFi7ePsu2FOnZE-LRYfaLeYv2PCPKCFaZnCjJS0asVa-UFXHhmz2sWxVwEi1OnENi11C4bweM6a_9ydUHi4w4QMBkZpfHCyondEdgCtxyq8xZXPsEP6_JX007Y9jm9gGQ8JExrsviYRMpeWFT1pVJ2HJJfbkrHrF1Fq7c";

const nonce = (start: number) => Uint8Array.from({ length: 12 }, (_, i) => start + i);

describe("device link channel", () => {
  it("matches appendix A byte for byte", async () => {
    const code = parseLinkCode(CODE);
    expect(code.linkId).toBe(LINK_ID);
    expect(Array.from(code.secret)).toEqual(Array.from({ length: 32 }, (_, i) => 0x20 + i));
    expect(code.endpoint).toBe("http://localhost:8080/api");

    expect(
      offerJson({
        deviceId: "00000000-0000-0000-0000-000000000001",
        deviceKey: "ed25519:IIKL9cW9ystoSGMzbCAvtVmdpIvlWWYVdCFwcFvsqfc",
        name: "Laptop",
        platform: "desktop",
      }),
    ).toBe(OFFER_PLAINTEXT);
    expect(ANSWER_PLAINTEXT.length).toBe(460);

    const channel = await openChannel(code);
    const offer = await seal(channel, "offer", OFFER_PLAINTEXT, nonce(0x40));
    expect(offer).toEqual({ nonce: "QEFCQ0RFRkdISUpL", ciphertext: OFFER_CIPHERTEXT });
    const answer = await seal(channel, "answer", ANSWER_PLAINTEXT, nonce(0x50));
    expect(answer).toEqual({ nonce: "UFFSU1RVVldYWVpb", ciphertext: ANSWER_CIPHERTEXT });

    expect(await open(channel, "offer", offer)).toBe(OFFER_PLAINTEXT);
    const opened = await open(channel, "answer", answer);
    expect(readAnswer(opened ?? "")).toEqual({ payload: CERT_PAYLOAD, signature: CERT_SIG });
    expect(await fingerprint(OFFER_PLAINTEXT)).toBe("QSFX-VHMA");
  });

  it("opens a message only on its link, in its direction, unchanged", async () => {
    const channel = await openChannel(parseLinkCode(CODE));
    const offer = await seal(channel, "offer", OFFER_PLAINTEXT, nonce(0x40));
    expect(await open(channel, "answer", offer)).toBeNull();
    const other = await openChannel(parseLinkCode(CODE.replace(LINK_ID, "AAECAwQFBgcICQoLDA0OEA")));
    expect(await open(other, "offer", offer)).toBeNull();
    expect(
      await open(channel, "offer", { ...offer, ciphertext: `K${offer.ciphertext.slice(1)}` }),
    ).toBeNull();
    expect(await open(channel, "offer", { ...offer, nonce: "QEFCQ0RFRkdISUpM" })).toBeNull();
    expect(await open(channel, "offer", { ...offer, nonce: "short" })).toBeNull();
  });

  it("reads codes as the spec says", () => {
    const wrapped = `  RIM-LINK:1:${LINK_ID}:\n${SECRET}:http://localhost:8080/api \n`;
    expect(parseLinkCode(wrapped).endpoint).toBe("http://localhost:8080/api");
    expect(parseLinkCode(CODE.replace("localhost:8080", "[::1]:8080")).endpoint).toBe(
      "http://[::1]:8080/api",
    );

    expect(() => parseLinkCode("hello")).toThrow(/not a RIM link code/);
    expect(() => parseLinkCode(CODE.replace(":1:", ":2:"))).toThrow(/newer app/);
    for (const version of ["0", "01"]) {
      expect(() => parseLinkCode(CODE.replace(":1:", `:${version}:`))).toThrow(/damaged/);
    }
    const long = `${CODE}/${"a".repeat(335 - CODE.length - 1)}`;
    expect(long).toHaveLength(335);
    expect(() => parseLinkCode(long)).toThrow(/damaged/);
    for (const bad of [
      CODE.replace(LINK_ID, `${LINK_ID}==`),
      CODE.replace(LINK_ID, LINK_ID.slice(1)),
      CODE.replace(LINK_ID, "AAECAwQFBgcICQoLDA0ODx"),
      CODE.replace(SECRET, SECRET.slice(1)),
      `${CODE}?x`,
      `${CODE}#x`,
      CODE.replace("http://", "http://me@"),
      CODE.replace("http://", "ftp://"),
      `${CODE}/`,
    ]) {
      expect(() => parseLinkCode(bad), bad).toThrow();
    }
  });

  it("refuses answers that are not exactly an answer", () => {
    const cert = { payload: CERT_PAYLOAD, signature: CERT_SIG };
    expect(readAnswer(JSON.stringify({ v: 1, type: "link-offer", certificate: cert }))).toBeNull();
    expect(readAnswer(JSON.stringify({ v: 2, type: "link-answer", certificate: cert }))).toBeNull();
    expect(
      readAnswer(JSON.stringify({ v: 1, type: "link-answer", certificate: cert, extra: 1 })),
    ).toBeNull();
    expect(
      readAnswer(
        JSON.stringify({ v: 1, type: "link-answer", certificate: { ...cert, extra: true } }),
      ),
    ).toBeNull();
    expect(readAnswer("not json")).toBeNull();
  });

  it("has the helpers the key code relies on", () => {
    expect(fromB64url("AQ")).toEqual(Uint8Array.of(1));
    expect(fromB64url("AR")).toBeNull();
    expect(audienceOf("https://Rim.Example.com:8443/api")).toBe("rim.example.com:8443");
    expect(sameEndpoint("http://h/api/", " http://h/api")).toBe(true);
    const id = uuidV7(Date.UTC(2026, 9, 9));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
