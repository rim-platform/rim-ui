import { beforeEach, describe, expect, it } from "vitest";

import { usePluginConfirmStore } from "./usePluginConfirmStore";

const RESTART = {
  pluginName: "Kubernetes Pods",
  commandTitle: "Pods: Restart pod",
  description: "",
  args: { pod: "web-1" },
};

describe("usePluginConfirmStore", () => {
  beforeEach(() => usePluginConfirmStore.getState().cancel());

  it("resolves with the user's answer", async () => {
    const yes = usePluginConfirmStore.getState().ask(RESTART);
    expect(usePluginConfirmStore.getState().request).toEqual(RESTART);
    usePluginConfirmStore.getState().confirm();
    await expect(yes).resolves.toBe(true);
    expect(usePluginConfirmStore.getState().request).toBeNull();

    const no = usePluginConfirmStore.getState().ask(RESTART);
    usePluginConfirmStore.getState().cancel();
    await expect(no).resolves.toBe(false);
  });

  it("declines a second request while the user reads the first", async () => {
    const first = usePluginConfirmStore.getState().ask(RESTART);
    const second = usePluginConfirmStore
      .getState()
      .ask({ ...RESTART, args: { pod: "database-0" } });
    await expect(second).resolves.toBe(false);
    // The dialog still shows what the user is reading, and their yes is for that run.
    expect(usePluginConfirmStore.getState().request).toEqual(RESTART);
    usePluginConfirmStore.getState().confirm();
    await expect(first).resolves.toBe(true);
  });
});
