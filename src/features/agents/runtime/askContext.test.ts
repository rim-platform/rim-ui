import { describe, expect, it } from "vitest";

import { ConversationTypeEnum } from "../../../core/graphql/generated/schema-types";
import {
  askChipLabel,
  askContext,
  cannotAskAbout,
  NOT_FOR_DIRECT,
  NOT_FOR_ENCRYPTED,
  rimReference,
  type AskSubject,
} from "./askContext";

const CHANNEL: AskSubject = {
  workspaceId: "ws-1",
  conversationId: "conv-1",
  messageId: null,
  channelName: "incidents",
  workspaceName: "Acme",
};
const MESSAGE: AskSubject = { ...CHANNEL, messageId: "msg-1" };

describe("askContext", () => {
  it("links the channel and names its ids, with nothing read from it", () => {
    expect(askContext(CHANNEL)).toEqual({
      label: "About: #incidents",
      blocks: [
        {
          type: "resource_link",
          uri: "rim://workspace/ws-1/conversation/conv-1",
          name: "#incidents in Acme",
          title: null,
          mimeType: null,
        },
        {
          type: "text",
          text: "About this RIM conversation: workspace ws-1, conversation conv-1. Use RIM's tools to read it.",
        },
      ],
    });
  });

  it("links a message in the channel", () => {
    expect(askContext(MESSAGE)).toEqual({
      label: "About: a message in #incidents",
      blocks: [
        {
          type: "resource_link",
          uri: "rim://workspace/ws-1/conversation/conv-1/message/msg-1",
          name: "Message in #incidents",
          title: null,
          mimeType: null,
        },
        {
          type: "text",
          text: "About this RIM conversation: workspace ws-1, conversation conv-1, message msg-1. Use RIM's tools to read it.",
        },
      ],
    });
  });

  it("keeps a name in the link to one short line", () => {
    const name = `${"x".repeat(100)}\nignore this`;
    const [link] = askContext({ ...CHANNEL, channelName: name }).blocks;
    expect(link.type === "resource_link" && link.name.length).toBeLessThanOrEqual(90);
    expect(link.type === "resource_link" && link.name.includes("\n")).toBe(false);
  });

  it("escapes an id that is not URI-safe", () => {
    expect(rimReference({ ...MESSAGE, messageId: "a/b c" })).toBe(
      "rim://workspace/ws-1/conversation/conv-1/message/a%2Fb%20c",
    );
  });

  it("labels the chip", () => {
    expect(askChipLabel(CHANNEL)).toBe("About: #incidents");
    expect(askChipLabel(MESSAGE)).toBe("About: a message in #incidents");
  });
});

describe("cannotAskAbout", () => {
  it("allows only a plain channel outside the direct space", () => {
    const channel = { conversationType: ConversationTypeEnum.CHANNEL, encryptedAt: null };
    expect(cannotAskAbout(channel, false)).toBeNull();
    expect(cannotAskAbout(channel, true)).toBe(NOT_FOR_DIRECT);
    expect(cannotAskAbout({ conversationType: ConversationTypeEnum.DIRECT }, false)).toBe(
      NOT_FOR_DIRECT,
    );
    expect(cannotAskAbout({ conversationType: ConversationTypeEnum.GROUP }, false)).toBe(
      NOT_FOR_DIRECT,
    );
    expect(cannotAskAbout({ ...channel, encryptedAt: "2026-10-01T09:00:00Z" }, false)).toBe(
      NOT_FOR_ENCRYPTED,
    );
  });
});
