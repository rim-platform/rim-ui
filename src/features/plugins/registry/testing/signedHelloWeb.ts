// Appendix A of the workspace plugins spec: Hello Web's bundle signed by the identity key from
// seed 1 at keySeq 0, whose key log is key-identity appendix B's version 2 inception alone.
// Never use these keys for real statements.

import { writeBundle } from "../../web/bundle";
import { HELLO_WEB_MAIN, HELLO_WEB_MANIFEST } from "../../web/testing/helloWeb";

export const PUBLISHER = "rimp1_txDLbnipi5i3kCJtJwBOUixzv_MY8OnU0mcy--Tyje0";

export const INCEPTION = {
  payload: `{"v":2,"type":"inception","seq":0,"identityKey":"ed25519:iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w","recoveryKey":"ed25519:1i8Bah79Hk_feT60LNhEceG6nwzwTRKHtcxx9hYofLg","createdAt":"2026-10-09T00:00:00Z"}`,
  signature:
    "ed25519:kGvSf1hR28cdKP2Smwmy2BHEdP7wmKwy0At-DtrUs8mYhfzF0jjHTjpeX4DAzXv5HuCVwFEYWM1DjN-6wkU2Ag",
};

export const SIGNED_HELLO_WEB = {
  payload: `{"v":2,"type":"plugin-manifest","principalId":"rimp1_txDLbnipi5i3kCJtJwBOUixzv_MY8OnU0mcy--Tyje0","keySeq":0,"publisherName":"Ada","pluginId":"dev.example.hello-web","version":"0.1.0","manifest":${JSON.stringify(HELLO_WEB_MANIFEST)},"source":{"kind":"bundle","sha256":"5b154b3eb45c3ebc44f6820ba30a389ce85b43dea34bcbf652b9b1a5416fbe85","size":1605},"issuedAt":"2026-10-09T00:00:00Z"}`,
  signature:
    "ed25519:FRHxrYnev03jlVo484kL4PLh7GMArjEE4q1wiBNMSx7rD8CAis8YIivjSccshXkEdvYEw-wAIjzQgzDRj6kGCg",
};

/** The bundle file the statement names, byte for byte. */
export function helloWebBundle(): Uint8Array {
  const encoder = new TextEncoder();
  return writeBundle([
    { path: "main.mjs", bytes: encoder.encode(HELLO_WEB_MAIN) },
    { path: "rim-plugin.json", bytes: encoder.encode(HELLO_WEB_MANIFEST) },
  ]);
}
