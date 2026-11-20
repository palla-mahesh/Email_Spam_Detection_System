import { ShieldAlert, ShieldCheck } from 'lucide-react';

export function VerdictLabel({ prediction }: { prediction: 'SPAM' | 'HAM' }) {
  if (prediction === 'SPAM') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-400 whitespace-nowrap shrink-0">
        <ShieldAlert className="w-4 h-4 shrink-0" aria-hidden="true" />
        <span>SPAM</span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-400 whitespace-nowrap shrink-0">
      <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
      <span>HAM (Legitimate)</span>
    </span>
  );
}
