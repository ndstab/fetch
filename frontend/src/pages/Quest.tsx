import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Logo } from '../components/Logo';
import { StatusChip } from '../components/StatusChip';
import { Timeline } from '../components/Timeline';
import { OptionCard } from '../components/OptionCard';
import {
  cancelQuest, pickOption, streamQuest,
} from '../lib/api';
import type { Option, Quest as QuestT, TimelineRow } from '../lib/types';

export function Quest() {
  const { id } = useParams<{ id: string }>();
  const [quest, setQuest] = useState<QuestT | null>(null);
  const [timeline, setTimeline] = useState<TimelineRow[]>([]);
  const [options, setOptions] = useState<Option[]>([]);
  const [picking, setPicking] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const seenIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!id) return;
    const close = streamQuest(id, {
      onSnapshot: (d) => {
        setQuest(d.quest);
        setTimeline(d.timeline);
        d.timeline.forEach((r) => seenIds.current.add(String(r.id)));
        setOptions(d.options);
      },
      onTimeline: (row) => {
        if (seenIds.current.has(String(row.id))) return;
        seenIds.current.add(String(row.id));
        setTimeline((prev) => [...prev, row]);
      },
      onStatus: (status, q) => {
        setQuest((prev) => q ?? (prev ? { ...prev, status: status as any } : prev));
      },
      onOptions: (opts) => setOptions(opts),
    });
    return close;
  }, [id]);

  const activePhase = useMemo(() => {
    if (!quest) return 'system';
    return ({
      created: 'system',
      paid: 'system',
      hunting: 'hunt',
      awaiting_pick: 'await_pick',
      buying: 'checkout',
      complete: 'settle',
      failed: 'system',
      cancelled: 'system',
    } as const)[quest.status] || 'system';
  }, [quest]);

  async function pick(idx: number) {
    if (!id) return;
    setPicking(idx);
    try {
      await pickOption(id, idx);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setPicking(null);
    }
  }

  async function cancel() {
    if (!id) return;
    if (!confirm('Cancel this quest and refund budget?')) return;
    try { await cancelQuest(id); } catch (e: any) { setErr(e.message); }
  }

  if (!quest) {
    return (
      <div className="min-h-screen grid place-items-center">
        <div className="text-ink-400 font-mono text-sm">Loading quest…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 md:px-10 py-6 border-b border-ink-800/60">
        <Logo size="sm" />
        <div className="flex items-center gap-3">
          <StatusChip status={quest.status} />
          {!['complete', 'failed', 'cancelled'].includes(quest.status) && (
            <button
              onClick={cancel}
              className="text-xs font-mono text-ink-400 hover:text-red-300 transition-colors px-3 py-1.5 border border-ink-700 rounded-full"
            >
              Cancel
            </button>
          )}
        </div>
      </nav>

      <main className="flex-1 max-w-6xl w-full mx-auto px-6 md:px-10 py-8 md:py-12 grid md:grid-cols-[minmax(0,1fr)_360px] gap-8 md:gap-12">
        {/* LEFT: Brief + options/receipt */}
        <section>
          <QuestBrief quest={quest} />

          <AnimatePresence mode="wait">
            {quest.status === 'awaiting_pick' && options.length > 0 && (
              <motion.div
                key="picker"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mt-10"
              >
                <PickerHeader />
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {options.map((o, i) => (
                    <OptionCard
                      key={String(o.id)}
                      option={o}
                      rank={i}
                      onPick={() => pick(o.idx)}
                      disabled={picking !== null}
                    />
                  ))}
                </div>
                <p className="text-xs font-mono text-ink-500 mt-5 text-center">
                  Not satisfied? <button onClick={cancel} className="underline hover:text-ink-300">cancel & refund</button>
                </p>
              </motion.div>
            )}

            {quest.status === 'buying' && (
              <motion.div
                key="buying"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="mt-10 rounded-2xl border border-lime/30 bg-lime/5 p-6"
              >
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-2 h-2 rounded-full bg-lime animate-pulse-soft" />
                  <span className="text-[11px] font-mono uppercase tracking-widest text-lime">
                    Buying in progress
                  </span>
                </div>
                <h3 className="font-display text-xl text-ink-100 mb-1">
                  Checking out on {options[quest.chosen_option_idx ?? 0]?.merchant}
                </h3>
                <p className="text-sm text-ink-400">
                  Virtual card minted · guest checkout running · order imminent
                </p>
                <div className="mt-5 h-1 rounded-full bg-ink-800 overflow-hidden">
                  <div className="h-full w-1/2 shimmer-bar" />
                </div>
              </motion.div>
            )}

            {quest.status === 'complete' && (
              <motion.div
                key="done"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-10"
              >
                <Receipt quest={quest} options={options} />
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* RIGHT: Timeline */}
        <aside className="md:sticky md:top-8 md:self-start">
          <div className="rounded-2xl border border-ink-800 bg-ink-900/60 backdrop-blur p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-sm text-ink-100">Live timeline</h3>
              <span className="text-[10px] font-mono text-ink-500">{timeline.length} events</span>
            </div>
            <div className="max-h-[60vh] overflow-y-auto pr-2">
              <Timeline rows={timeline} activePhase={activePhase} />
            </div>
            <MetaBlock quest={quest} />
          </div>
        </aside>
      </main>

      {err && (
        <div className="fixed bottom-5 right-5 bg-red-500/10 border border-red-400/40 text-red-300 text-sm px-4 py-2 rounded-lg">
          {err}
        </div>
      )}
    </div>
  );
}

function QuestBrief({ quest }: { quest: QuestT }) {
  return (
    <div>
      <div className="font-mono text-[11px] text-ink-500 uppercase tracking-widest mb-2">
        Quest {quest.id}
      </div>
      <h1 className="font-display text-3xl md:text-4xl text-ink-100 leading-tight">
        {quest.brief}
      </h1>
      <div className="flex flex-wrap items-center gap-2 mt-4 text-xs font-mono">
        <Pill label="Budget" value={`$${Number(quest.budget_usdc).toFixed(2)}`} />
        <Pill label="Fee" value={`$${Number(quest.service_fee_usdc).toFixed(2)}`} />
        <Pill label="Charged" value={`$${Number(quest.total_charged_usdc).toFixed(2)}`} highlight />
        {quest.deadline && <Pill label="Deadline" value={quest.deadline} />}
      </div>
    </div>
  );
}

function Pill({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border ${
      highlight
        ? 'border-lime/40 bg-lime/5 text-lime'
        : 'border-ink-700 bg-ink-900 text-ink-300'
    }`}>
      <span className="text-ink-500">{label}</span>
      <span className={highlight ? 'text-lime tabular-nums' : 'text-ink-100 tabular-nums'}>{value}</span>
    </div>
  );
}

function PickerHeader() {
  return (
    <div className="mb-5">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-2 h-2 rounded-full bg-flame animate-pulse-soft" />
        <span className="text-[11px] font-mono uppercase tracking-widest text-flame">
          Your pick
        </span>
      </div>
      <h2 className="font-display text-2xl text-ink-100 mb-1">Three options. One click.</h2>
      <p className="text-sm text-ink-400">
        The agent narrowed 14 listings down to these three. Pick one and it buys it.
      </p>
    </div>
  );
}

function Receipt({ quest, options }: { quest: QuestT; options: Option[] }) {
  const chosen = options.find((o) => o.idx === quest.chosen_option_idx);
  return (
    <div className="rounded-2xl border border-lime/30 bg-gradient-to-br from-lime/5 to-transparent p-7">
      <div className="flex items-center gap-2 mb-5">
        <div className="w-6 h-6 rounded-full bg-lime grid place-items-center">
          <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none">
            <path d="M3 8l3 3 7-7" stroke="#07070a" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <span className="text-[11px] font-mono uppercase tracking-widest text-lime">Delivered</span>
      </div>

      <h2 className="font-display text-3xl text-ink-100 mb-1">Order placed.</h2>
      <p className="text-ink-400 mb-6">
        {chosen ? `"${chosen.title}" from ${chosen.merchant}.` : 'Your item is on its way.'}
      </p>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 font-mono text-sm">
        <Stat label="Order #" value={quest.order_number || '—'} mono />
        <Stat label="Final cost" value={`$${Number(quest.final_cost_usdc || 0).toFixed(2)}`} />
        <Stat label="Refunded" value={`$${Number(quest.refunded_usdc || 0).toFixed(2)}`} />
        <Stat label="Saved" value={`$${(Number(quest.budget_usdc) - Number(quest.final_cost_usdc || 0)).toFixed(2)}`} highlight />
      </dl>

      {quest.tracking_url && (
        <a
          href={quest.tracking_url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 mt-6 bg-lime text-ink-950 font-semibold text-sm px-4 py-2.5 rounded-lg hover:shadow-lime-glow transition-all"
        >
          Track delivery →
        </a>
      )}
    </div>
  );
}

function Stat({ label, value, mono, highlight }: { label: string; value: string; mono?: boolean; highlight?: boolean }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-widest text-ink-500 mb-1">{label}</dt>
      <dd className={`tabular-nums ${mono ? 'font-mono' : 'font-sans'} ${highlight ? 'text-lime' : 'text-ink-100'}`}>
        {value}
      </dd>
    </div>
  );
}

function MetaBlock({ quest }: { quest: QuestT }) {
  const rows: [string, string | null][] = [
    ['Container', quest.container_id],
    ['Sub-wallet', quest.subwallet_id],
    ['Card', quest.card_id],
    ['Session', quest.checkout_session_id],
  ];
  return (
    <div className="mt-5 pt-4 border-t border-ink-800 space-y-1.5">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between text-[11px] font-mono">
          <span className="text-ink-500">{k}</span>
          <span className="text-ink-300 truncate max-w-[180px]">{v || '—'}</span>
        </div>
      ))}
    </div>
  );
}
