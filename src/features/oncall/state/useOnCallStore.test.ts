import { describe, it, expect, beforeEach } from "vitest";

import { useOnCallStore } from "./useOnCallStore";

describe("useOnCallStore", () => {
  beforeEach(() => {
    useOnCallStore.setState({ showOverrideModal: false, overrideScheduleId: null });
  });

  it("opens with no preselected schedule by default", () => {
    useOnCallStore.getState().openOverrideModal();
    expect(useOnCallStore.getState()).toMatchObject({
      showOverrideModal: true,
      overrideScheduleId: null,
    });
  });

  it("opens with a preselected schedule when given one", () => {
    useOnCallStore.getState().openOverrideModal("sched-1");
    expect(useOnCallStore.getState()).toMatchObject({
      showOverrideModal: true,
      overrideScheduleId: "sched-1",
    });
  });

  it("close resets both fields", () => {
    useOnCallStore.getState().openOverrideModal("sched-1");
    useOnCallStore.getState().closeOverrideModal();
    expect(useOnCallStore.getState()).toMatchObject({
      showOverrideModal: false,
      overrideScheduleId: null,
    });
  });
});
