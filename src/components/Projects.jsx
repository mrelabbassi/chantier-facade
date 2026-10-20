import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Badge, Field, Modal, ProgressBar, STATUTS, btnCls, btnGhost, fmtMAD, inputCls } from './ui.jsx';

const FIELDS = [
  ['name', 'Nom du chantier', 'text', true],
  ['client', 'Client'],
  ['adresse', 'Adresse'],
  ['date_debut', 'Date de démarrage', 'date'],
  ['date_fin_prevue', 'Date prévue de fin', 'date'],
  ['budget', 'Budget (DH)', 'number'],
  ['surface_facade', 'Surface de façade (m²)', 'number'],
  ['surface_menuiserie', 'Surface de menuiserie (m²)', 'number'],
  ['nombre_elements', "Nombre d'éléments", 'number'],
];
const NUMERIC = ['budget', 'surface_facade', 'surface_menuiserie', 'nombre_elements'];
const EMPTY = { name: '', client: '', adresse: '', date_debut: '', date_fin_prevue: '', budget: '', surface_facade: '', surface_menuiserie: '', nombre_elements: '', statut: 'Prospection' };

export default function Projects() {
  const [projects, setProjects] = useState(null);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');

  const [scope, setScope] = useState('active');
  const load = () => api(`/projects?scope=${scope}`).then(setProjects).catch((e) => setError(e.message));
  useEffect(() => { setProjects(null); load(); }, [scope]);

  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));

  const create = async (e) => {
    e.preventDefault();
    setError('');
    const body = Object.fromEntries(
      Object.entries(draft).map(([k, v]) => [k, NUMERIC.includes(k) ? Number(v || 0) : v || null]),
    );
    try {
      const { id } = await api('/projects', { method: 'POST', body });
      setDraft(null);
      window.location.hash = `#/projects/${id}`;
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">Chantiers</h1>
          <select className={`${inputCls} w-auto text-sm`} value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Afficher">
            <option value="active">En cours</option>
            <option value="archived">Archivés</option>
            <option value="all">Tous</option>
          </select>
        </div>
        <button className={btnCls} onClick={() => setDraft({ ...EMPTY })}>+ Nouveau chantier</button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!projects ? (
        <p className="text-slate-500">Chargement…</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => (
            <a key={p.id} href={`#/projects/${p.id}`} className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 hover:ring-blue-300">
              <div className="mb-1 flex items-start justify-between gap-2">
                <h2 className="font-semibold leading-snug">{p.name}</h2>
                <Badge className="shrink-0 bg-blue-50 text-blue-700">{p.statut}</Badge>
              </div>
              <p className="text-sm text-slate-500">{p.client}</p>
              <div className="mt-3">
                <div className="mb-1 flex justify-between text-sm"><span>Avancement</span><span className="tabular-nums">{p.avancement} %</span></div>
                <ProgressBar value={p.avancement} />
              </div>
              <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-500">
                <span>Budget {fmtMAD(p.budget)}</span>
                <span>{p.surface_facade} m² façade</span>
                <span className={p.tasks_late ? 'text-red-600' : ''}>{p.tasks_late} tâche(s) en retard</span>
                <span>{p.reserves_open} réserve(s)</span>
              </div>
            </a>
          ))}
        </div>
      )}

      {draft && (
        <Modal title="Nouveau chantier" onClose={() => setDraft(null)}>
          <form onSubmit={create} className="grid gap-3 sm:grid-cols-2">
            {FIELDS.map(([key, label, type = 'text', required]) => (
              <Field key={key} label={label}>
                <input className={inputCls} type={type} required={required} value={draft[key]} onChange={set(key)} />
              </Field>
            ))}
            <Field label="Statut">
              <select className={inputCls} value={draft.statut} onChange={set('statut')}>
                {STATUTS.map((s) => <option key={s}>{s}</option>)}
              </select>
            </Field>
            <div className="flex justify-end gap-2 pt-2 sm:col-span-2">
              <button type="button" className={btnGhost} onClick={() => setDraft(null)}>Annuler</button>
              <button className={btnCls}>Créer le chantier</button>
            </div>
            {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
          </form>
        </Modal>
      )}
    </div>
  );
}