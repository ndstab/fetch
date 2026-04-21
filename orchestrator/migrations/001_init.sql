-- Fetch orchestrator schema (v1)

CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  email          TEXT,
  wallet_address TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quests (
  id                  TEXT PRIMARY KEY,                      -- short slug, e.g. 'qst_7fZ9aA2p'
  user_id             TEXT REFERENCES users(id),
  brief               TEXT NOT NULL,
  address             TEXT NOT NULL,
  phone               TEXT NOT NULL,
  email               TEXT NOT NULL,
  budget_usdc         NUMERIC(10, 2) NOT NULL,               -- user-facing budget in USDC
  service_fee_usdc    NUMERIC(10, 2) NOT NULL,
  total_charged_usdc  NUMERIC(10, 2) NOT NULL,               -- budget + fee
  currency            TEXT NOT NULL DEFAULT 'USDC',
  deadline            TEXT,                                   -- free-form: 'by Friday', etc.
  status              TEXT NOT NULL DEFAULT 'created',        -- created|paid|hunting|awaiting_pick|buying|complete|failed|cancelled
  autoconfirm         BOOLEAN NOT NULL DEFAULT FALSE,

  checkout_session_id TEXT,
  container_id        TEXT,                                   -- Build-with-Locus service id
  container_url       TEXT,                                   -- svc-xxx.buildwithlocus.com
  subwallet_id        TEXT,
  card_id             TEXT,                                   -- set at Phase 4
  chosen_option_idx   INTEGER,

  order_number        TEXT,
  tracking_url        TEXT,
  receipt_json        JSONB,
  final_cost_usdc     NUMERIC(10, 2),
  refunded_usdc       NUMERIC(10, 2),

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at             TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_quests_status ON quests(status);
CREATE INDEX IF NOT EXISTS idx_quests_created ON quests(created_at DESC);

CREATE TABLE IF NOT EXISTS quest_timeline (
  id          BIGSERIAL PRIMARY KEY,
  quest_id    TEXT NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
  phase       TEXT NOT NULL,                                  -- 'plan'|'hunt'|'shortlist'|'await_pick'|'checkout'|'settle'|'system'
  level       TEXT NOT NULL DEFAULT 'info',                   -- 'info'|'warn'|'error'|'success'
  message     TEXT NOT NULL,
  detail      JSONB,
  cost_usdc   NUMERIC(10, 4),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_timeline_quest ON quest_timeline(quest_id, created_at);

CREATE TABLE IF NOT EXISTS quest_options (
  id            BIGSERIAL PRIMARY KEY,
  quest_id      TEXT NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
  idx           INTEGER NOT NULL,
  merchant      TEXT NOT NULL,
  title         TEXT NOT NULL,
  url           TEXT NOT NULL,
  image_url     TEXT,
  price_usdc    NUMERIC(10, 2) NOT NULL,
  delivery_eta  TEXT,
  reasoning     TEXT,
  tradeoff      TEXT,
  raw           JSONB,
  UNIQUE (quest_id, idx)
);

-- Webhook event log so we can replay/debug
CREATE TABLE IF NOT EXISTS webhook_events (
  id          BIGSERIAL PRIMARY KEY,
  source      TEXT NOT NULL,                                  -- 'locus_checkout' | ...
  event_type  TEXT,
  raw         JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
