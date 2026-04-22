import clsx from 'clsx';
import { motion } from 'framer-motion';
import type { Option } from '../lib/types';

export function OptionCard({
  option,
  onPick,
  disabled,
  rank,
  total,
  budget,
}: {
  option: Option;
  onPick: () => void;
  disabled?: boolean;
  rank: number;
  total: number;
  budget?: number;
}) {
  const priceNum = Number(option.price_usdc);
  const price = priceNum.toFixed(2);
  const label = labelFor(rank, total);
  const overBudget = typeof budget === 'number' && priceNum > budget + 0.005;
  const overBy = overBudget ? priceNum - (budget as number) : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: rank * 0.08 }}
      className={clsx(
        'relative group rounded-2xl p-[1px] overflow-hidden',
        'bg-gradient-to-br from-ink-700 via-ink-800 to-ink-900',
        'hover:from-lime/60 hover:via-ink-700 hover:to-ink-900 transition-colors',
      )}
    >
      <div className="rounded-2xl bg-ink-900 p-5 h-full flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <span className="font-mono text-[10px] uppercase tracking-widest text-ink-400">
            Option {String.fromCharCode(65 + rank)} · {label}
          </span>
          <span className="text-[11px] font-mono text-ink-400">{option.merchant}</span>
        </div>

        {option.image_url ? (
          <div className="aspect-[4/3] w-full rounded-lg overflow-hidden bg-ink-800 mb-4 flex items-center justify-center">
            <img
              src={option.image_url}
              alt={option.title}
              className="w-full h-full object-cover"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
            />
          </div>
        ) : (
          <div className="aspect-[4/3] w-full rounded-lg bg-ink-800 mb-4" />
        )}

        <h3 className="text-ink-100 text-[15px] font-medium leading-snug mb-3 line-clamp-2">
          {option.title}
        </h3>

        <div className="flex items-baseline gap-2 mb-2">
          <span className="font-display text-3xl font-semibold text-ink-100 tabular-nums">
            ${price}
          </span>
          <span className="text-xs text-ink-400 font-mono">USDC</span>
          {overBudget && (
            <span className="ml-auto text-[10px] font-mono uppercase tracking-widest text-flame bg-flame/10 border border-flame/30 rounded-full px-2 py-0.5">
              Over by ${overBy.toFixed(2)}
            </span>
          )}
        </div>

        <div className="text-xs text-ink-300 mb-3">
          <span className="text-ink-400">Delivery · </span>
          <span className="text-ink-100">{option.delivery_eta || '—'}</span>
        </div>

        {option.reasoning && (
          <p className="text-[13px] text-ink-300 leading-relaxed mb-1">
            <span className="text-lime">↗ </span>{option.reasoning}
          </p>
        )}
        {option.tradeoff && (
          <p className="text-[12px] text-ink-400 leading-relaxed mb-4">
            <span className="text-flame">• </span>{option.tradeoff}
          </p>
        )}

        <button
          onClick={onPick}
          disabled={disabled || overBudget}
          title={overBudget ? 'Over budget — increase budget to pick this option' : undefined}
          className={clsx(
            'mt-auto w-full py-2.5 rounded-lg text-sm font-semibold transition-all',
            overBudget
              ? 'bg-ink-800 text-ink-500 border border-ink-700'
              : 'bg-lime text-ink-950 hover:shadow-lime-glow hover:-translate-y-0.5',
            'disabled:opacity-50 disabled:pointer-events-none',
          )}
        >
          {overBudget ? 'Over budget' : 'Buy this'}
        </button>
      </div>
    </motion.div>
  );
}

function labelFor(rank: number, total: number) {
  if (total <= 1) return 'Top pick';
  if (total === 2) return rank === 0 ? 'Cheapest' : 'Alternative';
  if (rank === 0) return 'Cheapest';
  if (rank === total - 1) return 'Premium';
  return 'Mid-price';
}
