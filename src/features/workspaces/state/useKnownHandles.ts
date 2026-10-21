import { create } from "zustand";

import { parseHandle } from "../../../shared/utils/handles";

/** A person as a server answers them with their handle (`User.handle`). */
export interface HandleSource {
  id: string;
  handle?: string | null;
}

type KnownHandlesState = {
  /** The handle of each person a server answered one for, by user id. */
  byUser: Readonly<Record<string, string>>;
  /** Keeps the handles `people` carry; a person answered without one keeps what is known. */
  remember: (people: readonly (HandleSource | null | undefined)[]) => void;
};

/**
 * The handles this session has seen, from message authors and the signed-in account: the
 * workspace member list carries none, so a member's handle is known once a server answers it
 * with them.
 */
export const useKnownHandles = create<KnownHandlesState>((set, get) => ({
  byUser: {},
  remember: (people) => {
    const current = get().byUser;
    let next: Record<string, string> | null = null;
    for (const person of people) {
      if (!person || !parseHandle(person.handle)) continue;
      const handle = person.handle as string;
      if ((next ?? current)[person.id] === handle) continue;
      next ??= { ...current };
      next[person.id] = handle;
    }
    if (next) set({ byUser: next });
  },
}));

/** Remember the handles `people` carry; see {@link useKnownHandles}. */
export function rememberHandles(people: readonly (HandleSource | null | undefined)[]): void {
  useKnownHandles.getState().remember(people);
}
