/**
 * The web app's proof-of-work worker: one search per message, answered with the nonce. It is
 * stopped by terminating it.
 */

import { answerPowJob, type PowAnswer, type PowJob } from "./powSearch";

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<PowJob>) => void) | null;
  postMessage(answer: PowAnswer): void;
};

scope.onmessage = (event) => {
  scope.postMessage(answerPowJob(event.data));
};
