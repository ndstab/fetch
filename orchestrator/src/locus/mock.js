// In-process Locus mock. Simulates the primitives end-to-end so the orchestrator
// and the dashboard can be demoed without real credentials. Payments, sub-wallets,
// containers and cards all live in a Map.

import { nanoid } from 'nanoid';
import { config } from '../config.js';

export function createMockLocus() {
  const state = {
    sessions: new Map(),
    subwallets: new Map(),
    containers: new Map(),
    cards: new Map(),
  };

  // After a session is created, we auto-"pay" it ~2s later and POST the webhook
  // to our own orchestrator so the full flow runs without human action.
  async function fireMockCheckoutWebhook(sessionId) {
    const session = state.sessions.get(sessionId);
    if (!session) return;
    session.status = 'paid';
    try {
      await fetch(`${config.publicUrl}/webhooks/checkout`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-locus-signature': 'mock',
        },
        body: JSON.stringify({
          type: 'checkout.session.paid',
          data: {
            sessionId,
            amountUsdc: session.amountUsdc,
            metadata: session.metadata,
            txHash: `0xmock${nanoid(12)}`,
          },
        }),
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[locus-mock] webhook self-post failed:', err.message);
    }
  }

  return {
    mode: 'mock',

    async createCheckoutSession({ amountUsdc, description, successUrl, cancelUrl, webhookUrl, metadata }) {
      const sessionId = `cs_mock_${nanoid(10)}`;
      state.sessions.set(sessionId, {
        sessionId, amountUsdc, description, successUrl, cancelUrl, webhookUrl,
        metadata, status: 'pending', createdAt: Date.now(),
      });
      // Schedule the auto-pay
      setTimeout(() => fireMockCheckoutWebhook(sessionId), 2000);
      return {
        sessionId,
        hostedUrl: `${config.publicUrl}/mock/checkout/${sessionId}`,
      };
    },

    verifyWebhookSignature() {
      return true; // mock: trust everything
    },

    async createSubwallet({ amountUsdc, label }) {
      const subwalletId = `sw_mock_${nanoid(10)}`;
      state.subwallets.set(subwalletId, {
        subwalletId, balanceUsdc: Number(amountUsdc), label, spent: 0,
      });
      return { subwalletId, balanceUsdc: Number(amountUsdc) };
    },

    async refundSubwallet(subwalletId) {
      const sw = state.subwallets.get(subwalletId);
      if (!sw) return { refundedUsdc: 0, txHash: null };
      const refunded = sw.balanceUsdc - sw.spent;
      sw.balanceUsdc = sw.spent;
      return { refundedUsdc: refunded, txHash: `0xmock${nanoid(12)}` };
    },

    async deployQuestContainer({ questId }) {
      const serviceId = `svc_mock_${nanoid(8)}`;
      const projectId = `proj_mock_${nanoid(8)}`;
      const deploymentId = `dep_mock_${nanoid(8)}`;
      state.containers.set(serviceId, {
        serviceId, projectId, deploymentId, questId,
        status: 'deploying', createdAt: Date.now(),
      });
      // Move to healthy after ~3s
      setTimeout(() => {
        const c = state.containers.get(serviceId);
        if (c) c.status = 'healthy';
      }, 3000);
      return {
        serviceId, projectId, deploymentId,
        url: `https://svc-mock-${serviceId.slice(-8)}.buildwithlocus.com`,
      };
    },

    async containerStatus(serviceId) {
      const c = state.containers.get(serviceId);
      if (!c) return { status: 'not_found', url: null, lastLogs: [] };
      return { status: c.status, url: `https://svc-mock.buildwithlocus.com`, lastLogs: [] };
    },

    async teardownContainer(projectId) {
      for (const [sid, c] of state.containers.entries()) {
        if (c.projectId === projectId) state.containers.delete(sid);
      }
      return { ok: true };
    },

    async mintLasoCard({ amountUsdc, subwalletId }) {
      const cardId = `card_mock_${nanoid(8)}`;
      const sw = state.subwallets.get(subwalletId);
      if (sw) sw.spent += Number(amountUsdc);
      const card = {
        cardId,
        pan: '4111 1111 1111 ' + String(Math.floor(1000 + Math.random() * 9000)),
        cvv: String(Math.floor(100 + Math.random() * 900)),
        expMonth: '12',
        expYear: String(new Date().getFullYear() + 2),
        holderName: 'FETCH QUEST',
        amountUsdc: Number(amountUsdc),
      };
      state.cards.set(cardId, card);
      return card;
    },

    async voidLasoCard(cardId) {
      state.cards.delete(cardId);
      return { ok: true };
    },

    // Test helpers (mock-only)
    _state: state,
  };
}
