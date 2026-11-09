/** Approves the open agent request, after a warning. */
export const APPROVE_AGENT_REQUEST = "agents.approve_request";
/** Refuses the open agent request. */
export const REFUSE_AGENT_REQUEST = "agents.refuse_request";
/** Connects the program waiting to pair, after a warning. */
export const APPROVE_AGENT_PAIRING = "agents.approve_pairing";
/** Refuses the program waiting to pair. */
export const REFUSE_AGENT_PAIRING = "agents.refuse_pairing";

/** Opens the dialog that connects an agent from the app and shows its token once. */
export const CONNECT_AGENT = "agents.connect_agent";

/** The commands that answer a waiting agent: its request, or its asking to connect. */
export const AGENT_ANSWER_COMMAND_IDS: readonly string[] = [
  APPROVE_AGENT_REQUEST,
  REFUSE_AGENT_REQUEST,
  APPROVE_AGENT_PAIRING,
  REFUSE_AGENT_PAIRING,
];

/**
 * The app commands that answer and manage agents. Each is the person's own act: none is ever
 * offered to an agent as a tool or run for one.
 */
export const AGENT_MANAGEMENT_COMMAND_IDS: ReadonlySet<string> = new Set([
  ...AGENT_ANSWER_COMMAND_IDS,
  "agents.disconnect",
  "agents.choose_reads",
  "agents.choose_plugin_commands",
  "agents.open_runs",
  "agents.open_record",
  "agents.clear_record",
  CONNECT_AGENT,
  "agents.start_session",
  "agents.stop_session",
  "agents.ask_about_message",
  "agents.ask_about_conversation",
  "workspace.open_agent_sessions",
]);
