import { getSdk } from "./generated/sdk";
import { graphqlClient } from "./client";

export const graphqlSdk = getSdk(graphqlClient);
