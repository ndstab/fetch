import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Logo } from '../components/Logo';
import { createQuest, getConfig } from '../lib/api';

export function Landing() {
  const nav = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'mock' | 'real' | null>(null);
  useEffect(() => { getConfig().then((c) => setMode(c.mode)).catch(() => setMode(null)); }, []);
  const [form, setForm] = useState({
    brief: '',
    address: '',
    phone: '',
    email: '',
    budget: '',
    deadline: '',
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.brief.trim()) return;
    if (!expanded) { setExpanded(true); return; }
    setLoading(true);
    try {
      const { quest } = await createQuest({
        brief: form.brief,
        address: form.address,
        phone: form.phone,
        email: form.email,
        budgetUsdc: Number(form.budget),
        deadline: form.deadline || undefined,
      });
      nav(`/quest/${quest.id}`);
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 md:px-10 pt-6">
        <Logo />
        <div className="flex items-center gap-5 text-xs font-mono text-ink-400">
          <span className="hidden md:inline-flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full animate-pulse-soft ${mode === 'real' ? 'bg-flame' : 'bg-lime'}`} />
            {mode === 'real' ? 'live — real USDC' : mode === 'mock' ? 'mock mode' : '…'}
          </span>
          <a
            href="https://docs.paywithlocus.com"
            target="_blank"
            rel="noreferrer"
            className="hover:text-ink-100 transition-colors"
          >
            built on locus ↗
          </a>
        </div>
      </nav>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 pb-24">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="max-w-3xl w-full text-center"
        >
          <div className="inline-flex items-center gap-2 text-[11px] font-mono uppercase tracking-widest text-lime border border-lime/30 rounded-full px-3 py-1 mb-8">
            <span className="w-1 h-1 rounded-full bg-lime animate-pulse" />
            agent-native commerce
          </div>

          <h1 className="font-display text-5xl md:text-7xl font-semibold tracking-tight text-ink-100 leading-[1.05] mb-6">
            Tell an agent what you want.
            <br />
            <span className="text-lime">It buys it for you.</span>
          </h1>

          <p className="text-ink-300 text-lg md:text-xl max-w-xl mx-auto leading-relaxed mb-12">
            Each quest gets its own budget, its own virtual card, its own sandbox.
            <br className="hidden md:inline" />
            Three ranked picks. One click. Delivered.
          </p>

          <form onSubmit={submit} className="max-w-xl mx-auto">
            <div className="relative group">
              <div className="absolute -inset-px rounded-2xl bg-gradient-to-r from-lime/0 via-lime/40 to-lime/0 opacity-0 group-focus-within:opacity-100 transition-opacity blur-sm" />
              <div className="relative bg-ink-900 border border-ink-700 focus-within:border-lime/50 rounded-2xl overflow-hidden transition-colors">
                <textarea
                  value={form.brief}
                  onChange={(e) => setForm({ ...form, brief: e.target.value })}
                  placeholder="A copy of Shantaram by Gregory David Roberts, under $6…"
                  className="w-full bg-transparent text-ink-100 placeholder-ink-500 text-base md:text-lg px-5 py-4 resize-none h-[88px] focus:outline-none"
                />
                <div className="flex items-center justify-between px-5 py-3 border-t border-ink-800 bg-ink-900/50">
                  <span className="text-xs font-mono text-ink-400">
                    {expanded ? 'Almost there — fill in the rest' : 'Press enter to continue'}
                  </span>
                  <button
                    type="submit"
                    disabled={loading || !form.brief.trim()}
                    className="bg-lime text-ink-950 font-semibold text-sm px-4 py-2 rounded-lg hover:shadow-lime-glow transition-all disabled:opacity-40 disabled:pointer-events-none"
                  >
                    {loading ? 'Creating…' : expanded ? 'Launch quest →' : 'Continue →'}
                  </button>
                </div>
              </div>
            </div>

            {/* Expanded form */}
            <motion.div
              initial={false}
              animate={{
                height: expanded ? 'auto' : 0,
                opacity: expanded ? 1 : 0,
              }}
              transition={{ duration: 0.4 }}
              className="overflow-hidden"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4 text-left">
                <Field label="Budget (USDC)" required>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.budget}
                    onChange={(e) => setForm({ ...form, budget: e.target.value })}
                    placeholder="10.00"
                    required={expanded}
                    className="input"
                  />
                </Field>
                <Field label="Deadline (optional)">
                  <input
                    value={form.deadline}
                    onChange={(e) => setForm({ ...form, deadline: e.target.value })}
                    placeholder="by Friday"
                    className="input"
                  />
                </Field>
                <Field label="Delivery address" required className="md:col-span-2">
                  <input
                    value={form.address}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                    placeholder="B-402, Sunshine Apts, Andheri West, Mumbai 400053"
                    required={expanded}
                    className="input"
                  />
                </Field>
                <Field label="Phone" required>
                  <input
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    placeholder="+91 98765 43210"
                    required={expanded}
                    className="input"
                  />
                </Field>
                <Field label="Email" required>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="you@example.com"
                    required={expanded}
                    className="input"
                  />
                </Field>
              </div>
              <p className="text-[11px] text-ink-500 mt-3 font-mono">
                Address, phone, email go to the merchant only. We never see payment info directly — a single-use virtual card is minted just for this purchase.
              </p>
            </motion.div>

            {error && (
              <div className="mt-4 text-sm text-red-300 bg-red-500/10 border border-red-400/30 rounded-lg px-4 py-3">
                {error}
              </div>
            )}
          </form>

          <style>{`
            .input {
              width: 100%;
              background: #0b0b0f;
              border: 1px solid #1f1f28;
              border-radius: 10px;
              padding: 10px 14px;
              font-size: 14px;
              color: #eaeaf2;
              transition: border-color 0.15s ease;
            }
            .input::placeholder { color: #6e6e84; }
            .input:focus { border-color: rgba(199, 255, 58, 0.5); }
          `}</style>
        </motion.div>

        {/* How it works strip */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.4 }}
          className="mt-24 grid grid-cols-2 md:grid-cols-4 gap-6 max-w-4xl w-full"
        >
          {[
            ['01', 'Plan', 'Claude drafts the hunt'],
            ['02', 'Hunt', 'Brave + Firecrawl scan merchants'],
            ['03', 'Pick', 'You choose from 3 ranked options'],
            ['04', 'Buy', 'Single-use card checks out on the site'],
          ].map(([num, title, sub]) => (
            <div key={num} className="text-left">
              <div className="font-mono text-[11px] text-ink-400 mb-1">{num}</div>
              <div className="text-ink-100 font-medium mb-0.5">{title}</div>
              <div className="text-xs text-ink-400 leading-snug">{sub}</div>
            </div>
          ))}
        </motion.div>
      </main>

      <footer className="px-6 md:px-10 py-6 text-xs font-mono text-ink-500 flex justify-between">
        <span>© fetch · a locus-native experiment</span>
        <span>v0.1 · {new Date().getFullYear()}</span>
      </footer>
    </div>
  );
}

function Field({ label, required, children, className }: {
  label: string; required?: boolean; children: React.ReactNode; className?: string;
}) {
  return (
    <label className={`block ${className || ''}`}>
      <span className="block text-[11px] font-mono uppercase tracking-widest text-ink-400 mb-1.5">
        {label} {required && <span className="text-flame">*</span>}
      </span>
      {children}
    </label>
  );
}
