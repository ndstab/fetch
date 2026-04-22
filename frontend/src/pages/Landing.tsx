import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Logo } from '../components/Logo';
import { createQuest, getConfig } from '../lib/api';

const VERBS = ['buys it.', 'finds it.', 'ships it.', 'handles it.'];

const STEPS = [
  { num: '01', icon: '◎', title: 'Plan', desc: 'Claude maps the hunt strategy' },
  { num: '02', icon: '⌕', title: 'Hunt', desc: 'Brave + Firecrawl scan every merchant' },
  { num: '03', icon: '⊞', title: 'Pick', desc: 'You approve one of 3 ranked options' },
  { num: '04', icon: '◈', title: 'Buy', desc: 'A single-use virtual Visa checks out' },
];

const STATS = [
  { val: '~90s', label: 'quest to options' },
  { val: '3', label: 'ranked picks, always' },
  { val: '$0', label: 'unspent USDC kept' },
];

const WHY = [
  { tag: 'The problem', body: 'Comparing dozens of listings takes time, and autopilot checkout feels risky when spend limits are unclear.' },
  { tag: 'The solution', body: 'Fetch plans and hunts automatically, then shows three ranked options so you approve with one deliberate click.' },
  { tag: 'The safety layer', body: 'Per-quest budget caps and single-use virtual Visa cards keep every purchase scoped. Leftovers refund on settlement.' },
];

const USE_CASES = [
  { title: 'Time-sensitive buys', body: 'Gifts, replacements, urgent items — found and checked out before you finish your coffee.' },
  { title: 'Budget-constrained shopping', body: 'Hard budget + shortlist prevents accidental overspend and hidden checkout surprises.' },
  { title: 'Repeat purchasing', body: 'Reuse your intent, let the agent re-run hunt logic with current prices and availability.' },
  { title: 'Human-in-the-loop automation', body: 'You approve the final pick — but none of the search and comparison drudgery.' },
];

export function Landing() {
  const nav = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'mock' | 'real' | null>(null);
  const [verbIdx, setVerbIdx] = useState(0);

  useEffect(() => {
    getConfig().then((c) => setMode(c.mode)).catch(() => setMode(null));
  }, []);

  useEffect(() => {
    const t = setInterval(() => setVerbIdx((i) => (i + 1) % VERBS.length), 2800);
    return () => clearInterval(t);
  }, []);

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
    const budgetNum = Number(form.budget);
    if (!Number.isFinite(budgetNum) || budgetNum < 5) {
      setError('Budget must be at least $5 USDC. Laso virtual cards have a $5.00 minimum.');
      return;
    }
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
    <div className="min-h-screen flex flex-col relative overflow-x-hidden">
      {/* Ambient background */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <motion.div
          animate={{ x: [0, 40, 0], y: [0, -30, 0] }}
          transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute top-[-200px] left-[-100px] w-[700px] h-[700px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(199,255,58,0.07) 0%, transparent 70%)' }}
        />
        <motion.div
          animate={{ x: [0, -50, 0], y: [0, 40, 0] }}
          transition={{ duration: 26, repeat: Infinity, ease: 'easeInOut', delay: 5 }}
          className="absolute bottom-[-150px] right-[-200px] w-[800px] h-[800px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(255,120,73,0.05) 0%, transparent 70%)' }}
        />
        <motion.div
          animate={{ opacity: [0.3, 0.6, 0.3] }}
          transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(199,255,58,0.03) 0%, transparent 70%)' }}
        />
        {/* Subtle grid */}
        <div
          className="absolute inset-0 opacity-[0.025]"
          style={{
            backgroundImage: `linear-gradient(rgba(199,255,58,1) 1px, transparent 1px), linear-gradient(90deg, rgba(199,255,58,1) 1px, transparent 1px)`,
            backgroundSize: '64px 64px',
          }}
        />
      </div>

      {/* Nav */}
      <nav className="relative z-10 flex items-center justify-between px-6 md:px-10 pt-6">
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
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 pb-24">
        <motion.div
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          className="max-w-3xl w-full text-center"
        >
          {/* Badge */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1, duration: 0.5 }}
            className="inline-flex items-center gap-2 text-[11px] font-mono uppercase tracking-widest text-lime border border-lime/30 rounded-full px-3 py-1 mb-8 relative"
          >
            <span className="absolute inset-0 rounded-full bg-lime/5 animate-pulse-soft" />
            <span className="w-1 h-1 rounded-full bg-lime animate-pulse relative" />
            <span className="relative">agent-native commerce · powered by locus</span>
          </motion.div>

          {/* Headline with cycling verb */}
          <h1 className="font-display text-5xl md:text-7xl font-semibold tracking-tight text-ink-100 leading-[1.05] mb-6">
            Tell an agent what you want.
            <br />
            <span className="inline-block min-w-[3ch]">
              <AnimatePresence mode="wait">
                <motion.span
                  key={verbIdx}
                  initial={{ opacity: 0, y: 18, filter: 'blur(10px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  exit={{ opacity: 0, y: -18, filter: 'blur(10px)' }}
                  transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                  className="text-lime inline-block"
                >
                  {VERBS[verbIdx]}
                </motion.span>
              </AnimatePresence>
            </span>
          </h1>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3, duration: 0.6 }}
            className="text-ink-300 text-lg md:text-xl max-w-xl mx-auto leading-relaxed mb-12"
          >
            Each quest gets its own budget, its own virtual card, its own sandbox.
            <br className="hidden md:inline" />
            Three ranked picks. One click. Delivered.
          </motion.p>

          {/* Form */}
          <motion.form
            onSubmit={submit}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.6 }}
            className="max-w-xl mx-auto"
          >
            <div className="relative group">
              <div className="absolute -inset-px rounded-2xl bg-gradient-to-r from-lime/0 via-lime/40 to-lime/0 opacity-0 group-focus-within:opacity-100 transition-opacity duration-500 blur-sm" />
              <div
                className="absolute -inset-[2px] rounded-2xl opacity-0 group-focus-within:opacity-100 transition-opacity duration-700"
                style={{ background: 'linear-gradient(135deg, rgba(199,255,58,0.12), transparent 50%, rgba(255,120,73,0.06))', filter: 'blur(1px)' }}
              />
              <div className="relative bg-ink-900 border border-ink-700 focus-within:border-lime/50 rounded-2xl overflow-hidden transition-colors duration-300">
                <textarea
                  value={form.brief}
                  onChange={(e) => setForm({ ...form, brief: e.target.value })}
                  placeholder="A copy of Shantaram by Gregory David Roberts, under $6…"
                  className="w-full bg-transparent text-ink-100 placeholder-ink-500 text-base md:text-lg px-5 py-4 resize-none h-[88px] focus:outline-none"
                />
                <div className="flex items-center justify-between px-5 py-3 border-t border-ink-800 bg-ink-900/50">
                  <span className="text-xs font-mono text-ink-400">
                    {expanded ? 'Almost there — fill in the rest' : 'Describe what you want'}
                  </span>
                  <button
                    type="submit"
                    disabled={loading || !form.brief.trim()}
                    className="relative bg-lime text-ink-950 font-semibold text-sm px-4 py-2 rounded-lg hover:shadow-lime-glow transition-all disabled:opacity-40 disabled:pointer-events-none overflow-hidden group/btn"
                  >
                    <span className="absolute inset-0 bg-white/25 -translate-x-full group-hover/btn:translate-x-full transition-transform duration-500 skew-x-12" />
                    {loading ? (
                      <span className="relative flex items-center gap-2">
                        <span className="w-3 h-3 border-2 border-ink-950/30 border-t-ink-950 rounded-full animate-spin" />
                        Creating…
                      </span>
                    ) : (
                      <span className="relative">{expanded ? 'Launch quest →' : 'Continue →'}</span>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Expanded fields */}
            <motion.div
              initial={false}
              animate={{ height: expanded ? 'auto' : 0, opacity: expanded ? 1 : 0 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4 text-left">
                <Field label="Budget (USDC, min $5)" required>
                  <input type="number" step="0.01" min="5" value={form.budget}
                    onChange={(e) => setForm({ ...form, budget: e.target.value })}
                    placeholder="10.00" required={expanded} className="input" />
                </Field>
                <Field label="Deadline (optional)">
                  <input value={form.deadline}
                    onChange={(e) => setForm({ ...form, deadline: e.target.value })}
                    placeholder="by Friday" className="input" />
                </Field>
                <Field label="Delivery address" required className="md:col-span-2">
                  <input value={form.address}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                    placeholder="B-402, Sunshine Apts, Andheri West, Mumbai 400053"
                    required={expanded} className="input" />
                </Field>
                <Field label="Phone" required>
                  <input value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    placeholder="+91 98765 43210" required={expanded} className="input" />
                </Field>
                <Field label="Email" required>
                  <input type="email" value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="you@example.com" required={expanded} className="input" />
                </Field>
              </div>
              <p className="text-[11px] text-ink-500 mt-3 font-mono">
                Address, phone, email go to the merchant only. A single-use virtual card is minted just for this purchase — we never see payment credentials.
              </p>
            </motion.div>

            {error && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-4 text-sm text-red-300 bg-red-500/10 border border-red-400/30 rounded-lg px-4 py-3"
              >
                {error}
              </motion.div>
            )}
          </motion.form>

          {/* Trust pills */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.55, duration: 0.6 }}
            className="flex flex-wrap justify-center gap-2 mt-6"
          >
            {['1 quest = 1 virtual card', 'Budget hard-capped', 'Unspent USDC refunded', 'No credentials stored'].map((t) => (
              <span key={t} className="text-[10px] font-mono text-ink-400 border border-ink-800 rounded-full px-3 py-1 bg-ink-900/40">
                {t}
              </span>
            ))}
          </motion.div>

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
            .input:focus { border-color: rgba(199, 255, 58, 0.5); outline: none; }
          `}</style>
        </motion.div>

        {/* How it works */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.55 }}
          className="mt-28 max-w-4xl w-full"
        >
          <div className="text-center mb-10">
            <span className="font-mono text-[11px] uppercase tracking-widest text-ink-500">How it works</span>
          </div>
          <div className="relative grid grid-cols-2 md:grid-cols-4 gap-6">
            {/* Connector line */}
            <div
              className="hidden md:block absolute top-5 left-[calc(12.5%+20px)] right-[calc(12.5%+20px)] h-px"
              style={{ background: 'linear-gradient(90deg, transparent, rgba(199,255,58,0.25), rgba(199,255,58,0.25), transparent)' }}
            />
            {STEPS.map(({ num, icon, title, desc }, i) => (
              <motion.div
                key={num}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.6 + i * 0.1, duration: 0.5 }}
                className="relative text-left group"
              >
                <div className="w-10 h-10 rounded-xl border border-ink-700 bg-ink-900 flex items-center justify-center mb-3 text-lime text-lg group-hover:border-lime/40 group-hover:shadow-lime-glow transition-all duration-300 relative z-10">
                  {icon}
                </div>
                <div className="font-mono text-[10px] text-ink-500 mb-0.5">{num}</div>
                <div className="text-ink-100 font-semibold text-sm mb-1">{title}</div>
                <div className="text-xs text-ink-400 leading-snug">{desc}</div>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Stats */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.7 }}
          className="mt-16 max-w-4xl w-full grid grid-cols-3 gap-4"
        >
          {STATS.map(({ val, label }) => (
            <div
              key={label}
              className="rounded-2xl border border-ink-800 bg-ink-900/40 p-5 text-center hover:border-lime/20 hover:bg-ink-900/70 transition-all duration-300"
            >
              <div className="font-display text-3xl md:text-4xl font-semibold text-lime mb-1">{val}</div>
              <div className="text-xs font-mono text-ink-400">{label}</div>
            </div>
          ))}
        </motion.div>

        {/* Why cards */}
        <motion.section
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.8 }}
          className="mt-8 max-w-4xl w-full grid md:grid-cols-3 gap-4"
        >
          {WHY.map(({ tag, body }) => (
            <div
              key={tag}
              className="rounded-2xl border border-ink-800 bg-ink-900/60 p-5 text-left hover:border-lime/20 transition-all duration-300 group"
            >
              <div className="font-mono text-[11px] uppercase tracking-widest text-lime mb-2 group-hover:text-lime-soft transition-colors">{tag}</div>
              <p className="text-sm text-ink-300 leading-relaxed">{body}</p>
            </div>
          ))}
        </motion.section>

        {/* Use cases */}
        <motion.section
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.9 }}
          className="mt-8 max-w-4xl w-full rounded-2xl border border-ink-800 bg-ink-900/50 p-6 text-left"
        >
          <h3 className="font-display text-xl text-ink-100 mb-4">Where this shines</h3>
          <div className="grid sm:grid-cols-2 gap-4 text-sm text-ink-300">
            {USE_CASES.map(({ title, body }) => (
              <div key={title} className="rounded-xl bg-ink-950/60 border border-ink-800 p-4 hover:border-ink-700 transition-colors">
                <div className="text-ink-100 font-medium mb-1">{title}</div>
                <p>{body}</p>
              </div>
            ))}
          </div>
        </motion.section>
      </main>

      <footer className="relative z-10 px-6 md:px-10 py-6 text-xs font-mono text-ink-500 flex justify-between border-t border-ink-800/40">
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
