// The entry module the frame shell imports. `npm run plugin:bundle -- plugins/github-prs`
// builds it, with the SDK's browser build inside, into one main.mjs and a .rimbundle.
import { createPlugin } from "./plugin.ts";

await createPlugin().run();
