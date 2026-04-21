import clsx from 'clsx';
import type { QuestStatus } from '../lib/types';

const LABEL: Record<QuestStatus, string> = {
  created: 'Awaiting payment',
  paid: 'Paid — starting',
  hunting: 'Hunting',
  awaiting_pick: 'Your pick',
  buying: 'Buying',
  complete: 'Delivered',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export function StatusChip({ status }: { status: QuestStatus }) {
  const active = ['paid', 'hunting', 'buying'].includes(status);
  const done = status === 'complete';
  const attention = status === 'awaiting_pick';
  const bad = status === 'failed' || status === 'cancelled';

  return (
    <div
      className={clsx(
        'inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border',
        'font-mono tracking-wide',
        active && 'bg-lime/10 border-lime/40 text-lime',
        done && 'bg-lime/20 border-lime/60 text-lime-soft',
        attention && 'bg-flame/10 border-flame/50 text-flame',
        bad && 'bg-red-500/10 border-red-400/40 text-red-300',
        !active && !done && !attention && !bad && 'bg-ink-800 border-ink-700 text-ink-300',
      )}
    >
      <span
        className={clsx(
          'w-1.5 h-1.5 rounded-full',
          active && 'bg-lime animate-pulse-soft',
          done && 'bg-lime',
          attention && 'bg-flame animate-pulse-soft',
          bad && 'bg-red-400',
          !active && !done && !attention && !bad && 'bg-ink-400',
        )}
      />
      {LABEL[status] || status}
    </div>
  );
}
