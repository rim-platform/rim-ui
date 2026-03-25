import { createClient } from "graphql-ws";

function getWsEndpoint(): string {
  const httpEndpoint = import.meta.env.VITE_GRAPHQL_ENDPOINT || "http://localhost:8080/api";
  // Convert http(s) to ws(s) and append /ws
  return httpEndpoint
    .replace(/^http/, "ws")
    .replace(/\/api$/, "/api/ws");
}

export const wsClient = createClient({
  url: getWsEndpoint(),
  // Reconnect automatically
  retryAttempts: Infinity,
  retryWait: async (retries) => {
    // Exponential backoff: 1s, 2s, 4s, 8s, max 30s
    const delay = Math.min(1000 * Math.pow(2, retries), 30000);
    await new Promise((resolve) => setTimeout(resolve, delay));
  },
});
