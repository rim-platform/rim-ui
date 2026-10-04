import { describe, expect, it, vi, beforeEach } from "vitest";

const { invalidateQueriesMock } = vi.hoisted(() => ({
  invalidateQueriesMock: vi.fn(),
}));

vi.mock("../../../core/query/queryClient", () => ({
  queryClient: {
    invalidateQueries: (...args: unknown[]) => invalidateQueriesMock(...args),
  },
}));

import { invalidateAfterCommand } from "./postExecution";

describe("invalidateAfterCommand", () => {
  beforeEach(() => {
    invalidateQueriesMock.mockClear();
  });

  it("incident.ack with a string incidentId invalidates the scoped timeline + prefix-invalidates activeIncident", () => {
    invalidateAfterCommand("incident.ack", { incidentId: "inc-1" });

    expect(invalidateQueriesMock).toHaveBeenCalledWith({
      queryKey: ["incidentTimeline", "inc-1"],
    });
    expect(invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ["activeIncident"] });
    expect(invalidateQueriesMock).toHaveBeenCalledTimes(2);
  });

  it("incident.escalate with a string incidentId invalidates the scoped timeline + prefix-invalidates activeIncident", () => {
    invalidateAfterCommand("incident.escalate", { incidentId: "inc-2" });

    expect(invalidateQueriesMock).toHaveBeenCalledWith({
      queryKey: ["incidentTimeline", "inc-2"],
    });
    expect(invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ["activeIncident"] });
    expect(invalidateQueriesMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to a bare incidentTimeline prefix invalidation when incidentId is missing/non-string", () => {
    invalidateAfterCommand("incident.ack", {});

    expect(invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ["incidentTimeline"] });
    expect(invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ["activeIncident"] });
    expect(invalidateQueriesMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to a bare incidentTimeline prefix invalidation when incidentId is a non-string shape", () => {
    invalidateAfterCommand("incident.escalate", { incidentId: 42 });

    expect(invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ["incidentTimeline"] });
    expect(invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ["activeIncident"] });
  });

  it("does nothing for a non-incident command", () => {
    invalidateAfterCommand("chat.send_message", { conversation_id: "c1", text: "hi" });

    expect(invalidateQueriesMock).not.toHaveBeenCalled();
  });

  it("does nothing for oncall.who / oncall.take_shift (outside C2's two-entry map)", () => {
    invalidateAfterCommand("oncall.who", {});
    invalidateAfterCommand("oncall.take_shift", { userId: "u1" });

    expect(invalidateQueriesMock).not.toHaveBeenCalled();
  });
});
