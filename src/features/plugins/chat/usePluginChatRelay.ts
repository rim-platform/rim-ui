// Answers the `rim.chat.*` calls of local-process plugins: the Rust broker
// pushes each admitted call as `plugin-chat-request`, the message service
// answers it, and `plugin_chat_respond` hands the answer back to the plugin.
// A plugin's request to run a command the person granted it travels the same
// way and is answered by the command runner.

import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";

import { logger } from "../../../core/logger";
import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { safeInvoke } from "../../../core/tauri/safeInvoke";
import { ErrorCode, RpcError } from "../web/rpc";
import { runCommandForPlugin, type PluginRunResult } from "../runtime/pluginCommandRunner";
import { appMessageService } from "./appMessageService";
import type { MessageService } from "./messageService";

/** One call as the broker pushes it. */
export interface ChatRequest {
  requestId: number;
  pluginId: string;
  method: string;
  params: unknown;
  grantedCapabilities: string[];
}

/** The method of a plugin's request to run one of the app's own commands. */
const RUN_COMMAND_METHOD = "rim.command.execute";

/** Runs one of the app's own commands for a plugin, as `runCommandForPlugin` does. */
export type CommandRunner = (
  pluginId: string,
  commandId: unknown,
  args?: unknown,
) => Promise<PluginRunResult>;

/**
 * Answer one relayed call through `service`, or a request to run a command through
 * `runCommand`, and send the answer back to the broker.
 */
export async function answerChatRequest(
  request: ChatRequest,
  service: MessageService = appMessageService,
  runCommand: CommandRunner = runCommandForPlugin,
): Promise<void> {
  let answer: { result: unknown; error: null } | { result: null; error: object };
  try {
    const params = (request.params ?? {}) as { commandId?: unknown; args?: unknown };
    const result =
      request.method === RUN_COMMAND_METHOD
        ? await runCommand(request.pluginId, params.commandId, params.args)
        : await service.call(
            request.pluginId,
            request.method,
            request.params,
            request.grantedCapabilities,
          );
    answer = { result: result ?? null, error: null };
  } catch (error) {
    const rpc =
      error instanceof RpcError
        ? error
        : new RpcError(ErrorCode.INTERNAL_ERROR, (error as Error)?.message ?? String(error));
    answer = { result: null, error: rpc.toBody() };
  }
  const sent = await safeInvoke<boolean>("plugin_chat_respond", {
    requestId: request.requestId,
    ...answer,
  });
  if (!sent.ok) logger.warn("[RIM:Plugin] chat answer not delivered", sent.error);
}

/** Serve local-process plugins' chat calls while the desktop app runs them. */
export function usePluginChatRelay(): void {
  const { capabilities } = useRuntime();

  useEffect(() => {
    if (!capabilities.pluginHost) return;
    let unlisten: (() => void) | null = null;
    let live = true;
    void listen<ChatRequest>("plugin-chat-request", (event) => {
      void answerChatRequest(event.payload);
    })
      .then((stop) => {
        if (live) unlisten = stop;
        else stop();
      })
      .catch((error: unknown) => logger.warn("[RIM:Plugin] chat relay unavailable", error));
    return () => {
      live = false;
      unlisten?.();
    };
  }, [capabilities.pluginHost]);
}
