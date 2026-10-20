export const STATUTS = ['Prospection', 'Étude', 'Préparation', 'Fabrication', 'Livraison', 'Pose', 'Contrôle', 'Réserves', 'Réception', 'Terminé'];

export const fmtMAD = (n) => `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Number(n) || 0)} DH`;

export const fmtDate = (d) =>
  d ? new Date(`${d}T00:00:00`).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export const isLate = (due, progress) => Boolean(due) && progress < 100 && due < new Date().toISOString().slice(0, 10);

export const initials = (name = '') => name.split(' ').filter(Boolean).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

export const inputCls =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200';
export const btnCls =
  'rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50';
export const btnGhost = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50';

const PRIORITY_STYLES = {
  Haute: 'bg-red-100 text-red-700',
  Normale: 'bg-sky-100 text-sky-700',
  Basse: 'bg-slate-100 text-slate-600',
};

export function Badge({ children, className = '' }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>{children}</span>;
}

export function PriorityBadge({ value }) {
  return <Badge className={PRIORITY_STYLES[value] ?? PRIORITY_STYLES.Normale}>{value}</Badge>;
}

export function ProgressBar({ value, color = 'bg-blue-600', className = '' }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div className={`h-2 w-full overflow-hidden rounded-full bg-slate-200 ${className}`}>
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${v}%` }} />
    </div>
  );
}

export function Field({ label, children }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-slate-600">{label}</span>
      {children}
    </label>
  );
}

export function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:max-w-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label="Fermer">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}