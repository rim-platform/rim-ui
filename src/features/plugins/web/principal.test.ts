import { describe, expect, it } from "vitest";

import { principalOf, provisionalPrincipalId } from "./principal";

describe("principals", () => {
  it("derives the provisional id as the desktop host does", async () => {
    // The account and id of the desktop's protocol tests and the protocol spec's examples.
    expect(await provisionalPrincipalId("0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7b")).toBe(
      "rimp0_PWcag22GowE59KogGTaUReeoF_q4E5EVi28q83uaGBU",
    );
    expect(await provisionalPrincipalId(" 0192B3C4-5D6E-7F80-9A1B-2C3D4E5F6A7B ")).toBe(
      "rimp0_PWcag22GowE59KogGTaUReeoF_q4E5EVi28q83uaGBU",
    );
  });

  it("prefers the account's key-based id", async () => {
    const user = { userId: "u", displayName: "Ada", principalId: "rimp1_abc" };
    expect(await principalOf(user)).toEqual({ principalId: "rimp1_abc", displayName: "Ada" });
    const provisional = await principalOf({ ...user, principalId: "not-a-key-id" });
    expect(provisional.principalId.startsWith("rimp0_")).toBe(true);
  });
});
