// Locus adapter factory. Returns either the real HTTP client or an in-process mock
// based on config.locus.mode. The rest of the app depends only on the shape
// defined here — swapping is a one-env-var change.
//
// Shape (documented interface):
//   createCheckoutSession({ amountUsdc, description, successUrl, cancelUrl, webhookUrl, metadata })
//     -> { sessionId, hostedUrl }
//   verifyWebhookSignature(rawBody, signatureHeader) -> boolean
//   createSubwallet({ amountUsdc, parentWalletId, label, expiresAt })
//     -> { subwalletId, balanceUsdc }
//   refundSubwallet(subwalletId) -> { refundedUsdc, txHash }
//   deployQuestContainer({ questId, imageUri, env, region })
//     -> { serviceId, projectId, deploymentId, url }
//   containerStatus(serviceId) -> { status, url, lastLogs }
//   teardownContainer(projectId) -> { ok: true }
//   mintLasoCard({ amountUsdc, subwalletId, merchantHint })
//     -> { cardId, pan, cvv, expMonth, expYear, holderName }
//   voidLasoCard(cardId) -> { ok: true }

import { config } from '../config.js';
import { createMockLocus } from './mock.js';
import { createRealLocus } from './real.js';

let instance;

export function locus() {
  if (!instance) {
    instance = config.locus.mode === 'real'
      ? createRealLocus(config.locus)
      : createMockLocus(config.locus);
    // eslint-disable-next-line no-console
    console.log(`[locus] running in ${config.locus.mode.toUpperCase()} mode`);
  }
  return instance;
}
