import { createContext } from "react";

/** The user whose presence the timeline does not show, such as a DM peer yet to accept it. */
export const HiddenPresenceContext = createContext<string | null>(null);
