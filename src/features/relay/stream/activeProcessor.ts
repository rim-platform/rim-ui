/** The relay stream processor of the signed-in account, while the relay runs. */

import type { RelayStreamProcessor } from "./relayStream";

let active: RelayStreamProcessor | null = null;

export function setActiveProcessor(processor: RelayStreamProcessor | null): void {
  active = processor;
}

export function activeProcessor(): RelayStreamProcessor | null {
  return active;
}
