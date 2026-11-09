import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";

import { isVaultUnlocked, onVaultLock } from "../../../core/accountVault/accountVault";
import { logger } from "../../../core/logger";
import { toast } from "../../../shared/toast";
import { rejectOutsideAgentConfirmation } from "../../agent/state/confirmationModalStore";
import { desktopShowWindow } from "../../desktop-shell/api/desktopShell";
import { BUILD_VERSION } from "../../updater/api/updaterApi";
import {
  AGENT_BRIDGE_REQUEST_EVENT,
  agentBridgeAck,
  agentBridgeAnswer,
  agentBridgeStatus,
  type BridgeRequest,
} from "../api/agentBridge";
import { useConnectedAgentsStore } from "../state/useConnectedAgentsStore";
import { usePendingPairingStore } from "../state/usePendingPairingStore";
import { secureRandom } from "./agentCrypto";
import { appAgentChanges } from "./appAgentChanges";
import { appAgentCommands } from "./appAgentCommands";
import { appAgentPlugins } from "./appAgentPlugins";
import { appAgentReads } from "./appAgentReads";
import { handleBridgeRequest } from "./bridgeHandler";
import { createPairing } from "./pairing";

/** Whether the bridge is still listening. A status that cannot be read counts as not. */
async function stillListening(): Promise<boolean> {
  try {
    return (await agentBridgeStatus()).listening;
  } catch {
    logger.warn("[RIM:agents] could not read the bridge's status");
    return false;
  }
}

/**
 * Answers what agents ask through the bridge. It takes each request, answers nothing once the
 * bridge has stopped listening, forgets pairing and ends an agent's open confirmation when the
 * account locks, and brings the window forward for a request that needs the person.
 */
export function useAgentBridge(): void {
  useEffect(() => {
    let live = true;
    let stop: (() => void) | undefined;

    const pairing = createPairing({
      now: () => Date.now(),
      random: secureRandom,
      connect: (agent) => useConnectedAgentsStore.getState().add(agent),
      onPendingChanged: (view) => {
        usePendingPairingStore.setState({ pending: view });
        if (!view) return;
        desktopShowWindow().catch(() => {
          logger.warn("[RIM:agents] could not bring the window forward");
        });
      },
      setTimeout: (run, ms) => setTimeout(run, ms),
      clearTimeout: (timer) => clearTimeout(timer),
    });
    usePendingPairingStore.setState({
      approve: (requestId) => {
        pairing.approve(requestId).catch(() => {
          logger.warn("[RIM:agents] could not connect a program");
          toast.error("RIM could not connect this program");
        });
      },
      refuse: pairing.refuse,
      reset: pairing.reset,
    });
    const stopLock = onVaultLock(() => {
      pairing.reset();
      rejectOutsideAgentConfirmation();
    });

    const onRequest = async (request: BridgeRequest) => {
      try {
        await agentBridgeAck(request.id);
      } catch {
        logger.warn("[RIM:agents] could not take a request");
        return;
      }
      const listening = await stillListening();
      if (!live || !listening) return;
      const answer = await handleBridgeRequest(request, {
        unlocked: isVaultUnlocked,
        pairing,
        agents: () => useConnectedAgentsStore.getState().agents,
        mcp: {
          reads: appAgentReads,
          changes: appAgentChanges,
          plugins: appAgentPlugins,
          commands: appAgentCommands,
          version: BUILD_VERSION,
        },
      });
      await agentBridgeAnswer(request.id, answer.status, answer.body).catch(() => {
        logger.warn("[RIM:agents] could not answer a request");
      });
    };

    listen<BridgeRequest>(AGENT_BRIDGE_REQUEST_EVENT, (event) => {
      void onRequest(event.payload);
    }).then(
      (unlisten) => {
        if (live) stop = unlisten;
        else unlisten();
      },
      () => {
        logger.warn("[RIM:agents] could not listen for requests");
      },
    );

    return () => {
      live = false;
      stop?.();
      stopLock();
      pairing.reset();
      rejectOutsideAgentConfirmation();
      usePendingPairingStore.setState(usePendingPairingStore.getInitialState(), true);
    };
  }, []);
}
