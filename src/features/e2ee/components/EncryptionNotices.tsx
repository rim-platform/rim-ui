import { AlertTriangle, Lock, RotateCcw, ShieldAlert, UserX } from "lucide-react";

import {
  useDeviceNames,
  usePrincipalNames,
  type useE2eeConversation,
} from "../hooks/useE2eeConversation";
import { joinNames } from "../utils/names";

type E2eeConversation = ReturnType<typeof useE2eeConversation>;

interface EncryptionNoticesProps {
  workspaceId: string;
  e2ee: E2eeConversation;
}

function Notice({
  tone,
  icon,
  children,
}: {
  tone: "warning" | "danger" | "muted";
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const colors = {
    warning: "border-rim-warm/30 bg-rim-warm/10 text-rim-text",
    danger: "border-rim-danger/30 bg-rim-danger/10 text-rim-text",
    muted: "border-rim-line bg-rim-panel-soft text-rim-text-muted",
  }[tone];
  return (
    <div
      role="status"
      className={`mx-4 mb-2 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${colors}`}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Why this browser cannot read an encrypted conversation, by send block. */
const BROWSER_NOTICES: Record<string, string> = {
  noDeviceKey: "Set up this browser as a linked device to read encrypted conversations",
  unsupported: "This browser cannot run encrypted conversations",
  otherTab:
    "Encrypted conversations are open in another tab of this browser. Close it to read them here.",
};

/** What the conversation's encryption asks the person to know, above the composer. */
export function EncryptionNotices({ workspaceId, e2ee }: EncryptionNoticesProps) {
  const { nameOf } = usePrincipalNames(workspaceId);
  const unverified = e2ee.group?.unverified ?? [];
  const misbehaved = e2ee.group?.misbehaved ?? null;
  const deviceNameOf = useDeviceNames([
    ...unverified.map((u) => u.principalId),
    ...(misbehaved ? [misbehaved.principalId] : []),
  ]);

  const notices: React.ReactNode[] = [];
  if (e2ee.notReady.length > 0) {
    const [first, ...rest] = e2ee.notReady;
    notices.push(
      <Notice key="not-ready" tone="muted" icon={<Lock className="h-3.5 w-3.5" aria-hidden />}>
        Not encrypted yet: {rest.length === 0 ? first : joinNames(e2ee.notReady)}{" "}
        {rest.length === 0 ? "has" : "have"} not set up encryption on a desktop device
      </Notice>,
    );
  }
  if (e2ee.upgradeOnDesktop) {
    notices.push(
      <Notice key="upgrade" tone="muted" icon={<Lock className="h-3.5 w-3.5" aria-hidden />}>
        Not encrypted yet: everyone is ready, and a member&apos;s desktop app turns encryption on
        here when it opens this conversation. A browser does not.
      </Notice>,
    );
  }
  if (e2ee.sendBlock === "encryptionReset") {
    notices.push(
      <Notice key="reset" tone="danger" icon={<RotateCcw className="h-3.5 w-3.5" aria-hidden />}>
        <p className="font-medium">Encryption was reset by the server</p>
        <p>
          The server no longer says this conversation is end-to-end encrypted. RIM keeps it
          encrypted on this device and has stopped sending here.
        </p>
      </Notice>,
    );
  }
  if (e2ee.foreignMembers.length > 0) {
    notices.push(
      <Notice key="foreign" tone="danger" icon={<UserX className="h-3.5 w-3.5" aria-hidden />}>
        <p className="font-medium">
          The server tried to add {joinNames(e2ee.foreignMembers)} to this conversation
        </p>
        <p>
          A direct message stays between its two people. Sending is stopped here until{" "}
          {e2ee.foreignMembers.length === 1 ? "they are" : "they are all"} gone.
        </p>
      </Notice>,
    );
  }
  const browser = BROWSER_NOTICES[e2ee.sendBlock ?? ""];
  if (browser) {
    notices.push(
      <Notice key="browser" tone="muted" icon={<Lock className="h-3.5 w-3.5" aria-hidden />}>
        {browser}
      </Notice>,
    );
  }
  const forked = [
    ...new Set(unverified.filter((u) => u.reason === "keyLogForked").map((u) => u.principalId)),
  ];
  if (forked.length > 0) {
    notices.push(
      <Notice key="forked" tone="danger" icon={<ShieldAlert className="h-3.5 w-3.5" aria-hidden />}>
        {joinNames(forked.map((p) => nameOf(p)))}
        {forked.length === 1 ? "'s identity" : "'s identities"} changed in a way RIM cannot verify
      </Notice>,
    );
  }
  if (unverified.length > 0) {
    const devices = unverified.map(
      (u) => `${nameOf(u.principalId)}'s ${deviceNameOf(u.deviceId)} (${u.deviceId.slice(0, 8)})`,
    );
    notices.push(
      <Notice
        key="unverified"
        tone="danger"
        icon={<ShieldAlert className="h-3.5 w-3.5" aria-hidden />}
      >
        <p className="font-medium">Unverified device present: {joinNames(devices)}</p>
        <p>
          RIM cannot verify this device, and it can read new messages. Sending is stopped here until
          it is removed.
        </p>
      </Notice>,
    );
  }
  if (misbehaved && unverified.length === 0) {
    notices.push(
      <Notice
        key="misbehaved"
        tone="warning"
        icon={<AlertTriangle className="h-3.5 w-3.5" aria-hidden />}
      >
        {nameOf(misbehaved.principalId)}&apos;s {deviceNameOf(misbehaved.deviceId)} made a
        membership change that did not match what it announced. Every device was checked again.
      </Notice>,
    );
  }
  if (e2ee.sendBlock === "awaitingReadd") {
    notices.push(
      <Notice
        key="readd"
        tone="warning"
        icon={<AlertTriangle className="h-3.5 w-3.5" aria-hidden />}
      >
        This device can&apos;t read new messages until another device re-adds it
      </Notice>,
    );
  }
  if (e2ee.sendBlock === "removed") {
    notices.push(
      <Notice key="removed" tone="muted" icon={<Lock className="h-3.5 w-3.5" aria-hidden />}>
        This device is no longer part of this encrypted conversation.
      </Notice>,
    );
  }
  return notices.length > 0 ? <div>{notices}</div> : null;
}
