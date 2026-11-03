import { useQueryClient } from "@tanstack/react-query";

import { blockPerson } from "../blocking/blockPerson";
import { useBlockPersonStore } from "../blocking/useBlockPersonStore";
import { BlockConfirmDialog } from "./BlockConfirmDialog";

/** The confirmation of a Block… from a person menu, a hover card or a DM's menu. */
export function BlockPersonDialog() {
  const queryClient = useQueryClient();
  const target = useBlockPersonStore((s) => s.target);
  const close = useBlockPersonStore((s) => s.close);
  if (!target) return null;
  return (
    <BlockConfirmDialog
      name={target.name}
      onConfirm={() => {
        close();
        void blockPerson(queryClient, target);
      }}
      onClose={close}
    />
  );
}
