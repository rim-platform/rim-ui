import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
    mutations: {
      // A write made while offline fails at once rather than waiting, paused, to be sent
      // when the network returns: nothing is queued behind the user's back.
      networkMode: "always",
    },
  },
});
