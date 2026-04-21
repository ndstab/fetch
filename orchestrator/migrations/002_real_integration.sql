-- v2 — fields for real-integration payment + deployment tracking.

ALTER TABLE quests
  ADD COLUMN IF NOT EXISTS payer_address      TEXT,
  ADD COLUMN IF NOT EXISTS payment_tx_hash    TEXT,
  ADD COLUMN IF NOT EXISTS webhook_secret     TEXT,
  ADD COLUMN IF NOT EXISTS container_project_id TEXT,
  ADD COLUMN IF NOT EXISTS container_env_id   TEXT,
  ADD COLUMN IF NOT EXISTS deployment_id      TEXT,
  ADD COLUMN IF NOT EXISTS refund_tx_hash     TEXT;
