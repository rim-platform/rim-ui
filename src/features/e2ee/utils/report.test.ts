import { describe, expect, it } from "vitest";

import type { MessageItem } from "../../../core/types/messages";
import { b64, utf8 } from "../../key-identity/browser/bytes";
import { withMentionNames } from "./content";
import { encryptedReport, parseReportedContent } from "./report";

/** The content of the spec's known-answer message, with one attachment. */
const REPORTED_CONTENT =
  '{"v":1,"type":"message","id":"0199d1a0-0000-7000-8000-000000000002","rev":0,"threadRootId":null,"body":"hi <@rimp1_nz1POml8JmCMcFDECrtu60ibohPKnywhcExmOPMvTUo>","mentions":["rimp1_nz1POml8JmCMcFDECrtu60ibohPKnywhcExmOPMvTUo"],"mentionAll":false,"replyTo":null,"forwardedFrom":null,"attachments":[{"blobSha256":"EHFcZ6hUOIdDi32ptdrCXM2PTHQwKF46-0Ls56yQrac","secret":"oKGio6SlpqeoqaqrrK2ur7CxsrO0tba3uLm6u7y9vr8","name":"hello.txt","mime":"text/plain","size":18}],"linkPreviews":[]}';

function message(e2ee: MessageItem["e2ee"]): MessageItem {
  return {
    id: "0199d1a0-0000-7000-8000-000000000002",
    serverId: "ws-1",
    conversationId: "0199d1a0-0000-7000-8000-000000000001",
    authorId: "0199d1a0-0000-7000-8000-0000000000aa",
    author: null,
    text: "hi",
    hasAttachments: true,
    isPinned: false,
    mentionedUserIds: [],
    forwardedFromMessageId: null,
    forwardedFrom: null,
    isDeleted: false,
    sentAt: "2026-10-09T00:00:00.123456Z",
    reactions: [],
    attachments: [],
    linkPreviews: [],
    e2ee,
  };
}

const decrypted: NonNullable<MessageItem["e2ee"]> = {
  status: "decrypted",
  incarnation: 1,
  epoch: 1,
  senderDeviceId: "00000000-0000-0000-0000-000000000001",
  senderPrincipalId: "rimp1_txDLbnipi5i3kCJtJwBOUixzv_MY8OnU0mcy--Tyje0",
  receipt: "nCXNZlm5cHRpapRFrTI-Bh3rqvX5evXtLyzUYVDT23U",
  receiptKeyId: 1,
  sentAtUs: "1791504000123456",
  frankingKey: "YGFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6e3x9fn8",
  rev: 0,
  content: REPORTED_CONTENT,
};

describe("encryptedReport", () => {
  it("reveals the cached content, franking key and receipt", () => {
    const report = encryptedReport(message(decrypted), "ws-1", "abuse");
    expect(report).toEqual({
      input: {
        serverId: "ws-1",
        conversationId: "0199d1a0-0000-7000-8000-000000000001",
        messageId: "0199d1a0-0000-7000-8000-000000000002",
        reason: "abuse",
        content: btoa(REPORTED_CONTENT).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
        frankingKey: "YGFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6e3x9fn8",
        receipt: "nCXNZlm5cHRpapRFrTI-Bh3rqvX5evXtLyzUYVDT23U",
        receiptKeyId: 1,
        senderUserId: "0199d1a0-0000-7000-8000-0000000000aa",
        senderDeviceId: "00000000-0000-0000-0000-000000000001",
        sentAtUs: "1791504000123456",
      },
    });
  });

  it("refuses what this device cannot prove", () => {
    const refusal = (e2ee: MessageItem["e2ee"]) => {
      const report = encryptedReport(message(e2ee), "ws-1", "abuse");
      return "refusal" in report ? report.refusal : null;
    };
    expect(refusal({ ...decrypted, status: "undecryptable" })).toMatch(/could not decrypt/);
    expect(refusal({ ...decrypted, status: "invalid" })).toMatch(/could not be verified/);
    expect(refusal(null)).toMatch(/could not decrypt/);
    expect(refusal({ ...decrypted, receipt: null })).toMatch(/not reached the server/);
    expect(refusal({ ...decrypted, frankingKey: undefined })).toMatch(/not reached the server/);
  });
});

describe("parseReportedContent", () => {
  it("reads the body and attachments of verified content", () => {
    const content = parseReportedContent(b64(utf8(REPORTED_CONTENT)));
    expect(content?.body).toBe("hi <@rimp1_nz1POml8JmCMcFDECrtu60ibohPKnywhcExmOPMvTUo>");
    expect(content?.attachments).toEqual([
      {
        blobSha256: "EHFcZ6hUOIdDi32ptdrCXM2PTHQwKF46-0Ls56yQrac",
        name: "hello.txt",
        mime: "text/plain",
        size: 18,
      },
    ]);
    expect(new TextDecoder().decode(content?.bytes)).toBe(REPORTED_CONTENT);
    expect(
      withMentionNames(content!.body, (p) =>
        p === "rimp1_nz1POml8JmCMcFDECrtu60ibohPKnywhcExmOPMvTUo" ? "Bob" : undefined,
      ),
    ).toBe("hi @Bob");
  });

  it("answers null for bytes that are not content", () => {
    expect(parseReportedContent("not base64url!")).toBeNull();
    expect(parseReportedContent("e30")).toBeNull();
  });
});
