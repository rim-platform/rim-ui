import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { MemberRemoval } from "../../conversations/api/useMemberRemovals";
import { MembershipNoticeRow } from "./MembershipNoticeRow";

const removal: MemberRemoval = {
  id: "r1",
  userId: "bob",
  removedById: "alice",
  removedAt: "2026-11-01T10:30:00Z",
  user: null,
  removedBy: null,
};

const names: Record<string, string> = { bob: "Bob", alice: "Alice" };

function show(currentUserId: string | undefined) {
  render(
    <MembershipNoticeRow
      notice={{ kind: "removed", removal }}
      currentUserId={currentUserId}
      nameOf={(userId) => names[userId]}
    />,
  );
}

describe("MembershipNoticeRow", () => {
  it("says who removed whom", () => {
    show("carol");
    expect(screen.getByText("Bob was removed by Alice")).toBeInTheDocument();
  });

  it("speaks to the person who was removed", () => {
    show("bob");
    expect(screen.getByText("You were removed by Alice")).toBeInTheDocument();
  });

  it("says the viewer removed them", () => {
    show("alice");
    expect(screen.getByText("Bob was removed by you")).toBeInTheDocument();
  });
});
