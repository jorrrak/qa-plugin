import type { ReactNode } from 'react';
import { useState } from 'react';

export function Button({
  children,
  onClick,
  variant = 'ghost',
  disabled,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'danger' | 'ghost';
  disabled?: boolean;
  title?: string;
}) {
  const styles = {
    primary: 'bg-sky-600 text-white hover:bg-sky-500',
    danger: 'bg-red-600 text-white hover:bg-red-500',
    ghost:
      'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700',
  }[variant];

  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${styles}`}
    >
      {children}
    </button>
  );
}

/** Click-to-copy monospace value. Confirms in place rather than with a toast. */
export function CopyableCode({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      dir="ltr"
      title={value}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
      className="block w-full truncate rounded bg-slate-100 px-1.5 py-1 text-start font-mono text-[11px] text-slate-600 transition hover:bg-slate-200 dark:bg-slate-800/70 dark:text-slate-400 dark:hover:bg-slate-700"
    >
      {copied ? '✓ copied' : (label ?? value)}
    </button>
  );
}

export function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{title}</p>
      <p className="text-xs leading-relaxed text-slate-400 dark:text-slate-500">{hint}</p>
    </div>
  );
}

export function Badge({
  children,
  tone = 'slate',
}: {
  children: ReactNode;
  tone?: 'slate' | 'sky' | 'amber' | 'red' | 'emerald';
}) {
  const tones = {
    slate: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
    sky: 'bg-sky-100 text-sky-700 dark:bg-sky-900/60 dark:text-sky-300',
    amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300',
    red: 'bg-red-100 text-red-700 dark:bg-red-900/60 dark:text-red-300',
    emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300',
  }[tone];

  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${tones}`}>
      {children}
    </span>
  );
}
