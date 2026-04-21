import clsx from 'clsx';
import { motion, AnimatePresence } from 'framer-motion';
import type { TimelineRow } from '../lib/types';

const PHASE_LABEL: Record<string, string> = {
  system: 'System',
  plan: 'Plan',
  hunt: 'Hunt',
  shortlist: 'Shortlist',
  await_pick: 'Awaiting pick',
  checkout: 'Checkout',
  settle: 'Settle',
};

const PHASE_COLOR: Record<string, string> = {
  system: 'text-ink-400',
  plan: 'text-sky-300',
  hunt: 'text-violet-300',
  shortlist: 'text-fuchsia-300',
  await_pick: 'text-flame',
  checkout: 'text-lime',
  settle: 'text-lime-soft',
};

export function Timeline({ rows, activePhase }: { rows: TimelineRow[]; activePhase?: string }) {
  return (
    <div className="relative">
      {/* Vertical rail */}
      <div className="absolute left-[10px] top-2 bottom-2 w-px bg-gradient-to-b from-ink-700 via-ink-700 to-transparent" />

      <AnimatePresence initial={false}>
        {rows.map((row) => (
          <motion.div
            key={String(row.id)}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.25 }}
            className="relative pl-8 pb-4"
          >
            <Dot level={row.level} active={activePhase === row.phase} />
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className={clsx('font-mono text-[10px] uppercase tracking-widest', PHASE_COLOR[row.phase] || 'text-ink-400')}>
                {PHASE_LABEL[row.phase] ?? row.phase}
              </span>
              <span className="text-ink-400 text-[11px] font-mono">
                {fmtTime(row.created_at)}
              </span>
              {row.cost_usdc && Number(row.cost_usdc) > 0 && (
                <span className="text-ink-500 text-[10px] font-mono">
                  · ${Number(row.cost_usdc).toFixed(2)}
                </span>
              )}
            </div>
            <div
              className={clsx(
                'text-[14px] leading-snug mt-0.5',
                row.level === 'success' && 'text-lime-soft',
                row.level === 'error' && 'text-red-300',
                row.level === 'warn' && 'text-flame',
                (!row.level || row.level === 'info') && 'text-ink-100',
              )}
            >
              {row.message}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function Dot({ level, active }: { level: string; active?: boolean }) {
  const color =
    level === 'success' ? 'bg-lime'
    : level === 'error' ? 'bg-red-400'
    : level === 'warn' ? 'bg-flame'
    : 'bg-ink-400';
  return (
    <div className="absolute left-0 top-1.5">
      <div className={clsx('w-5 h-5 rounded-full grid place-items-center',
        active ? 'bg-lime/15' : 'bg-ink-800')}>
        <div className={clsx('w-2 h-2 rounded-full', color, active && 'animate-pulse-soft')} />
      </div>
    </div>
  );
}

function fmtTime(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch { return ''; }
}
