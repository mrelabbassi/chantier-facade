import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Field, PriorityBadge, btnCls, btnGhost, fmtDate, inputCls, isLate } from './ui.jsx';

export const RESERVE_STATUSES = ['Ouverte', 'En cours', 'Corrigée', 'Contrôlée', 'Clôturée'];
const EMPTY = { zone: '', repere: '', description: '', responsable_id: '', priority: 'Normale', date_limite: '' };

export default function Reserves({ projectId }) {
  const [rows, setRows] = useState(null);
  const [users, setUsers] = useState([]);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');

  const load = () => api(`/projects/${projectId}/reserves`).then(setRows).catch((e) => setError(e.message));

  useEffect(() => {
    load();
    api('/users').then(setUsers).catch(() => {});
  }, [projectId]);

  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));

  const create = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api(`/projects/${projectId}/reserves`, {
        method: 'POST',
        body: {
          ...draft,
          zone: draft.zone || null,
          repere: draft.repere || null,
          responsable_id: draft.responsable_id || null,
          date_limite: draft.date_limite || null,
        },
      });
      setDraft(null);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const setStatus = async (r, statut) => {
    await api(`/reserves/${r.id}`, { method: 'PATCH', body: { statut } });
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">Workflow : Ouverte → En cours → Corrigée → Contrôlée → Clôturée</p>
        {!draft && <button className={btnCls} onClick={() => setDraft({ ...EMPTY })}>+ Réserve</button>}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}

      {draft && (
        <form onSubmit={create} className="grid gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Description">
              <input className={inputCls} required value={draft.description} onChange={set('description')} />
            </Field>
          </div>
          <Field label="Zone"><input className={inputCls} value={draft.zone} onChange={set('zone')} /></Field>
          <Field label="Repère"><input className={inputCls} value={draft.repere} onChange={set('repere')} placeholder="FA-025" /></Field>
          <Field label="Responsable">
            <select className={inputCls} value={draft.responsable_id} onChange={set('responsable_id')}>
              <option value="">— Non assigné —</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Field>
          <Field label="Priorité">
            <select className={inputCls} value={draft.priority} onChange={set('priority')}>
              <option>Haute</option><option>Normale</option><option>Basse</option>
            </select>
          </Field>
          <Field label="Date limite"><input type="date" className={inputCls} value={draft.date_limite} onChange={set('date_limite')} /></Field>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <button type="button" className={btnGhost} onClick={() => setDraft(null)}>Annuler</button>
            <button className={btnCls}>Créer la réserve</button>
          </div>
        </form>
      )}

      {!rows ? (
        <p className="text-slate-500">Chargement…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-500">Aucune réserve sur ce chantier.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((r) => (
            <article key={r.id} className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">Réserve n°{r.numero}</span>
                <PriorityBadge value={r.priority} />
              </div>
              <p className="text-sm">{r.description}</p>
              <p className="mt-2 text-xs text-slate-500">
                {[r.zone, r.repere].filter(Boolean).join(' · ') || 'Non localisée'}
                {r.responsable_name && ` · ${r.responsable_name}`}
              </p>
              <p className={`mt-1 text-xs ${isLate(r.date_limite, r.statut === 'Clôturée' ? 100 : 0) ? 'font-medium text-red-600' : 'text-slate-500'}`}>
                Échéance : {fmtDate(r.date_limite)}
              </p>
              <select
                value={r.statut}
                onChange={(e) => setStatus(r, e.target.value)}
                className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
              >
                {RESERVE_STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}