import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { inputCls } from './ui.jsx';

const TVA = [0, 7, 10, 20];
const STATUS_CLS = {
  'Brouillon': 'bg-slate-100 text-slate-700',
  'Envoyé': 'bg-sky-100 text-sky-800',
  'Accepté': 'bg-emerald-100 text-emerald-800',
  'Refusé': 'bg-rose-100 text-rose-800',
  'Annulé': 'bg-slate-200 text-slate-600',
};
// Transitions proposées ; les règles sont vérifiées côté serveur
const NEXT = { 'Brouillon': ['Envoyé', 'Annulé'], 'Envoyé': ['Accepté', 'Refusé', 'Annulé'] };
const ACTION_LABEL = {
  'Envoyé': 'Marquer envoyé',
  'Accepté': 'Accepté par le client',
  'Refusé': 'Refusé par le client',
  'Annulé': 'Annuler le devis',
};

const money = (n) => `${Number(n ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`;
const emptyLine = () => ({ designation: '', quantity: '1', unit: 'u', unit_price: '', tva_rate: 20 });

function QuoteForm({ opps, onSaved, onError }) {
  const [f, setF] = useState({ opportunity_id: '', valid_until: '', notes: '' });
  const [lines, setLines] = useState([emptyLine()]);
  const setLine = (i, k, v) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  const submit = async (e) => {
    e.preventDefault();
    try {
      const q = await api('/crm/quotes', { method: 'POST', body: { ...f, lines } });
      setF({ opportunity_id: '', valid_until: '', notes: '' });
      setLines([emptyLine()]);
      onSaved(q);
    } catch (err) {
      onError(err.message);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="grid gap-3 md:grid-cols-3">
        <select required className={inputCls} value={f.opportunity_id} onChange={(e) => setF({ ...f, opportunity_id: e.target.value })}>
          <option value="">Opportunité *</option>
          {opps.map((o) => (
            <option key={o.id} value={o.id}>{o.name}{o.account_name ? ` — ${o.account_name}` : ''}</option>
          ))}
        </select>
        <label className="block">
          <span className="text-xs text-slate-500">Valide jusqu'au</span>
          <input type="date" className={inputCls} value={f.valid_until} onChange={(e) => setF({ ...f, valid_until: e.target.value })} />
        </label>
        <input className={inputCls} placeholder="Conditions, délais" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </div>

      <div className="space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="grid gap-2 md:grid-cols-[2fr_80px_80px_120px_110px_auto]">
            <input required className={inputCls} placeholder="Désignation *" value={l.designation} onChange={(e) => setLine(i, 'designation', e.target.value)} />
            <input required inputMode="decimal" className={inputCls} placeholder="Qté" value={l.quantity} onChange={(e) => setLine(i, 'quantity', e.target.value)} />
            <input className={inputCls} placeholder="Unité" value={l.unit} onChange={(e) => setLine(i, 'unit', e.target.value)} />
            <input required inputMode="decimal" className={inputCls} placeholder="PU HT (DH) *" value={l.unit_price} onChange={(e) => setLine(i, 'unit_price', e.target.value)} />
            <select className={inputCls} value={l.tva_rate} onChange={(e) => setLine(i, 'tva_rate', Number(e.target.value))}>
              {TVA.map((r) => <option key={r} value={r}>TVA {r} %</option>)}
            </select>
            <button
              type="button"
              disabled={lines.length === 1}
              onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
              className="text-xs text-red-600 hover:underline disabled:opacity-30"
            >
              Retirer
            </button>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={() => setLines((ls) => [...ls, emptyLine()])} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50">
          + Ligne
        </button>
        <button type="submit" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
          Créer le devis (brouillon)
        </button>
      </div>
    </form>
  );
}

function QuoteDetail({ quote, canWrite, canAmounts, onChange, onError }) {
  const run = async (fn) => {
    try {
      await fn();
      onChange();
    } catch (e) {
      onError(e.message);
    }
  };
  const setStatus = (status) => run(() => api(`/crm/quotes/${quote.id}`, { method: 'PATCH', body: { status } }));
  const remove = () => {
    if (!window.confirm(`Supprimer le brouillon ${quote.number} ?`)) return;
    run(() => api(`/crm/quotes/${quote.id}`, { method: 'DELETE' }));
  };
  const actions = canWrite ? (NEXT[quote.status] ?? []) : [];

  return (
    <div className="space-y-4 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">
            {quote.number}
            <span className={`ml-2 rounded px-1.5 py-0.5 text-xs ${STATUS_CLS[quote.status]}`}>{quote.status}</span>
          </h2>
          <p className="text-sm text-slate-500">{quote.account_name} · {quote.opportunity_name}</p>
          {quote.valid_until && <p className="text-xs text-slate-500">Valide jusqu'au {quote.valid_until}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {actions.map((s) => (
            <button key={s} type="button" onClick={() => setStatus(s)} className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs hover:bg-slate-50">
              {ACTION_LABEL[s]}
            </button>
          ))}
          {canWrite && quote.status === 'Brouillon' && (
            <button type="button" onClick={remove} className="rounded-lg border border-red-300 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50">
              Supprimer le brouillon
            </button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr>
              <th className="py-1">Désignation</th>
              <th>Qté</th>
              <th>Unité</th>
              {canAmounts && <th className="text-right">PU HT</th>}
              {canAmounts && <th className="text-right">TVA</th>}
              {canAmounts && <th className="text-right">Total HT</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {quote.lines.map((l, i) => (
              <tr key={i}>
                <td className="py-1.5">{l.designation}</td>
                <td>{l.quantity}</td>
                <td>{l.unit}</td>
                {canAmounts && <td className="text-right tabular-nums">{money(l.unit_price)}</td>}
                {canAmounts && <td className="text-right tabular-nums">{l.tva_rate} %</td>}
                {canAmounts && <td className="text-right tabular-nums">{money(l.line_ht)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canAmounts && quote.ttc !== undefined && (
        <dl className="ml-auto w-full max-w-xs space-y-1 text-sm">
          <div className="flex justify-between"><dt className="text-slate-500">Total HT</dt><dd className="tabular-nums">{money(quote.ht)}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">TVA</dt><dd className="tabular-nums">{money(quote.tva)}</dd></div>
          <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold"><dt>Total TTC</dt><dd className="tabular-nums">{money(quote.ttc)}</dd></div>
        </dl>
      )}

      {quote.notes && <p className="text-sm text-slate-600">{quote.notes}</p>}
      {quote.accepted_at && <p className="text-xs text-emerald-700">Accepté le {quote.accepted_at.slice(0, 10)}</p>}
    </div>
  );
}

export default function CrmQuotes({ opps, canWrite, canAmounts, onError }) {
  const [list, setList] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [adding, setAdding] = useState(false);

  const load = () => api('/crm/quotes').then(setList).catch((e) => onError(e.message));
  useEffect(() => { load(); }, []);

  if (!list) return <p className="text-slate-500">Chargement…</p>;
  const selected = list.find((q) => q.id === openId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Devis</h2>
        {canWrite && (
          <button
            type="button"
            onClick={() => setAdding((a) => !a)}
            className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            {adding ? 'Fermer' : '+ Nouveau devis'}
          </button>
        )}
      </div>

      {adding && (
        <QuoteForm
          opps={opps}
          onError={onError}
          onSaved={(q) => { setAdding(false); setOpenId(q.id); load(); }}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <ul className="divide-y divide-slate-100 self-start overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          {list.map((q) => (
            <li key={q.id}>
              <button
                type="button"
                onClick={() => setOpenId(q.id)}
                className={`w-full px-3 py-2 text-left text-sm hover:bg-slate-50 ${openId === q.id ? 'bg-blue-50' : ''}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{q.number}</span>
                  <span className={`rounded px-1.5 py-0.5 text-xs ${STATUS_CLS[q.status]}`}>{q.status}</span>
                </div>
                <div className="text-xs text-slate-500">{q.account_name} · {q.opportunity_name}</div>
                {canAmounts && q.ttc !== undefined && <div className="text-xs tabular-nums text-slate-700">{money(q.ttc)} TTC</div>}
              </button>
            </li>
          ))}
          {list.length === 0 && <li className="px-3 py-4 text-sm text-slate-500">Aucun devis pour le moment.</li>}
        </ul>

        <div>
          {selected ? (
            <QuoteDetail
              quote={selected}
              canWrite={canWrite}
              canAmounts={canAmounts}
              onError={onError}
              onChange={load}
            />
          ) : (
            <p className="text-sm text-slate-500">Sélectionnez un devis pour voir ses lignes et son statut.</p>
          )}
        </div>
      </div>
    </div>
  );
}