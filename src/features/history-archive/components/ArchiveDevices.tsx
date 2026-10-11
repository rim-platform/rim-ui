import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";

import type { CacheAccount } from "../../messages/api/messageCache";
import {
  STALE_BACKUP_MS,
  archiveDevicesQueryKey,
  listArchiveDevices,
  type DeviceBackup,
} from "../api/historyArchive";

function backupText(device: DeviceBackup): string {
  if (device.unreadable) return "its backup list cannot be read";
  if (device.lastExportMs === null) return "no backup yet";
  const when = new Date(device.lastExportMs).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  return `last backup ${when}`;
}

/**
 * The devices that back this account up into the archive and when each last did, read from
 * the archive itself. A device with nothing backed up for over seven days is pointed out.
 */
export function ArchiveDevices({ account }: { account: CacheAccount }) {
  const { data, error } = useQuery({
    queryKey: archiveDevicesQueryKey(account),
    retry: false,
    queryFn: async () => {
      const result = await listArchiveDevices(account);
      if (!result.ok) throw new Error(result.error.message);
      // The time the list was read, to judge each device's last backup against.
      return { devices: result.value, readAt: Date.now() };
    },
  });
  if (error) {
    return (
      <p className="text-xs text-rim-text-faint">
        The devices&apos; backups cannot be read right now.
      </p>
    );
  }
  if (!data) return null;
  if (data.devices.length === 0) {
    return <p className="text-xs text-rim-text-faint">No device has backed up yet.</p>;
  }
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium text-rim-text">Devices</p>
      <ul className="space-y-1.5">
        {data.devices.map((device) => {
          const stale =
            device.lastExportMs !== null && data.readAt - device.lastExportMs > STALE_BACKUP_MS;
          return (
            <li key={device.deviceId} className="text-xs">
              <p className="text-rim-text-muted">
                <span className="text-rim-text">
                  {device.thisDevice ? "This device" : "Device"}
                </span>{" "}
                <span className="font-mono">{device.deviceId.slice(0, 8)}</span>:{" "}
                {backupText(device)}
              </p>
              {stale && (
                <p className="mt-0.5 flex items-start gap-1 text-rim-warm">
                  <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                  Nothing backed up from it for over seven days. If it has been in use, check
                  Settings &gt; History there.
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
