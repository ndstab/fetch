import { Link } from 'react-router-dom';

export function Logo({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const h = size === 'sm' ? 'text-xl' : 'text-2xl';
  return (
    <Link to="/" className="group inline-flex items-center gap-2 select-none">
      <div className="relative">
        <div className="w-7 h-7 rounded-lg bg-lime grid place-items-center shadow-lime-glow transition-transform group-hover:rotate-12">
          <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none">
            <path d="M3 8l3 3 7-7" stroke="#07070a" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
      <span className={`font-display font-semibold tracking-tight ${h} text-ink-100`}>
        fetch
        <span className="text-lime">.</span>
      </span>
    </Link>
  );
}
