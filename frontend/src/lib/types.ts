export type QuestStatus =
  | 'created'
  | 'paid'
  | 'hunting'
  | 'awaiting_pick'
  | 'buying'
  | 'complete'
  | 'failed'
  | 'cancelled';

export interface Quest {
  id: string;
  brief: string;
  address: string;
  phone: string;
  email: string;
  budget_usdc: string;
  service_fee_usdc: string;
  total_charged_usdc: string;
  deadline: string | null;
  status: QuestStatus;
  checkout_session_id: string | null;
  container_id: string | null;
  container_url: string | null;
  subwallet_id: string | null;
  card_id: string | null;
  chosen_option_idx: number | null;
  order_number: string | null;
  tracking_url: string | null;
  final_cost_usdc: string | null;
  refunded_usdc: string | null;
  created_at: string;
  paid_at: string | null;
  completed_at: string | null;
}

export interface TimelineRow {
  id: number | string;
  quest_id: string;
  phase: 'plan' | 'hunt' | 'shortlist' | 'await_pick' | 'checkout' | 'settle' | 'system';
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  detail: Record<string, unknown> | null;
  cost_usdc: string | null;
  created_at: string;
}

export interface Option {
  id: number | string;
  quest_id: string;
  idx: number;
  merchant: string;
  title: string;
  url: string;
  image_url: string | null;
  price_usdc: string | number;
  delivery_eta: string | null;
  reasoning: string | null;
  tradeoff: string | null;
}
