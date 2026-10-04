import { describe, it, expect } from "vitest";
import { MESSAGES_QUERY } from "./queries";

describe("MESSAGES_QUERY", () => {
  it("is defined", () => {
    expect(MESSAGES_QUERY).toBeDefined();
  });

  it("contains the Messages operation", () => {
    // graphql-request gql returns a DocumentNode or string;
    // verify the query text includes expected fields
    const queryStr =
      typeof MESSAGES_QUERY === "string" ? MESSAGES_QUERY : JSON.stringify(MESSAGES_QUERY);
    expect(queryStr).toContain("messages");
    expect(queryStr).toContain("serverId");
    expect(queryStr).toContain("conversationId");
    expect(queryStr).toContain("pageInfo");
  });
});
