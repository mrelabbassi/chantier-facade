import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { ProgressBar, STATUTS, fmtDate, fmtMAD, inputCls } from './ui.jsx';
import Kanban from './Kanban.jsx';
import Facade from './Facade.jsx';
import Reserves from './Reserves.jsx';
import Photos from './Photos.jsx';
import Documents from './Documents.jsx';

const TABS = [
  ['kanban', 'Kanban'],
  ['facade', 'Éléments de façade'],
  ['reserves', 'Réserves'],
  ['photos', 'Photos'],
  ['documents', 'Documents'],
  ['synthese', 'Synthèse & avancement'],
];
const LOTS = {
  etudes: 'Études',
  approvisionnement: 'Approvisionnement',
  fabrication: 'Fabrication',
  controle: 'Contrôle',
  livraison: 'Livraison',
  pose: 'Pose',
};
const INFO = [
  ['client', 'Client'],
  ['maitre_ouvrage', "Maître d'ouvrage"],
  ['architecte', 'Architecte'],
  ['bureau_etudes', "Bureau d'études"],
  ['bureau_controle', 'Bureau de contrôle'],
  ['entreprise_generale', 'Entreprise générale'],
  ['adresse', 'Adresse'],
  ['date_debut', 'Date de démarrage'],
  ['date_fin_prevue', 'Fin prévue'],
  ['surface_menuiserie', 'Surface de menuiserie (m²)'],
];

export default function ProjectDetail({ id }) {
  const [project, setProject] = useState(null);
  const [tab, setTab] = useState('kanban');
  const [error, setError] = useState('');
  const [me, setMe] = useState(null);
  useEffect(() => { api('/auth/me').then(setMe).catch(() => {}); }, []);
  const canManage = !!me && ['ADMIN', 'DIRECTEUR', 'CHEF_DE_PROJET', 'CONDUCTEUR'].includes(me.role);
  const canDelete = !!me && ['ADMIN', 'DIRECTEUR'].includes(me.role);

  const setArchived = async (archive) => {
    try {
      await api(`/projects/${id}/${archive ? 'archive' : 'restore'}`, { method: 'POST' });
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Supprimer définitivement « ${project.name} » ? Documents, photos, réserves et tâches seront effacés.`)) return;
    try {
      await api(`/projects/${id}`, { method: 'DELETE' });
      window.location.hash = '#/projects';
    } catch (e) {
      setError(e.message);
    }
  };

  const load = useCallback(() => api(`/projects/${id}`).then(setProject).catch((e) => setError(e.message)), [id]);
  useEffect(() => { load(); }, [load]);

  const changeStatut = async (statut) => {
    await api(`/projects/${id}`, { method: 'PATCH', body: { statut } });
    load();
  };

  if (error) return <p className="text-red-600">{error}</p>;
  if (!project) return <p className="text-slate-500">Chargement…</p>;

  
    const kpis = [
    ['Avancement', `${project.avancement} %`],
    ...(project.budget !== undefined ? [['Budget', fmtMAD(project.budget)]] : []),
    ['Éléments', `${project.nombre_elements} · ${project.surface_facade} m²`],
    ['Tâches en retard', project.tasks_late, project.tasks_late ? 'text-red-600' : ''],
    ['Réserves ouvertes', project.reserves_open, project.reserves_open ? 'text-amber-600' : ''],
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <a href="#/projects" className="text-sm text-blue-600 hover:underline">← Chantiers</a>
          <h1 className="text-xl font-semibold">{project.name}</h1>
          <p className="text-sm text-slate-500">{project.adresse}</p>
          {project.archived_at && <p className="mt-1 text-xs font-medium text-amber-700">Chantier archivé</p>}
          {canManage && (
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              {project.archived_at ? (
                <button type="button" onClick={() => setArchived(false)} className="rounded-lg border border-slate-300 px-2.5 py-1 hover:bg-slate-50">Restaurer</button>
              ) : (
                <button type="button" onClick={() => setArchived(true)} className="rounded-lg border border-slate-300 px-2.5 py-1 hover:bg-slate-50">Archiver</button>
              )}
              {canDelete && project.archived_at && (
                <button type="button" onClick={remove} className="rounded-lg border border-red-300 px-2.5 py-1 text-red-600 hover:bg-red-50">Supprimer définitivement</button>
              )}
            </div>
          )}
        </div>
        <select className={`${inputCls} w-auto`} value={project.statut} onChange={(e) => changeStatut(e.target.value)} aria-label="Statut du chantier">
          {STATUTS.map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {kpis.map(([label, value, cls = '']) => (
          <div key={label} className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
            <p className="text-xs text-slate-500">{label}</p>
            <p className={`mt-1 text-lg font-semibold tabular-nums ${cls}`}>{value}</p>
          </div>
        ))}
      </div>

      <nav className="flex gap-1 overflow-x-auto border-b border-slate-200">
        {TABS.map(([key, label]) => (
        
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm ${tab === key ? 'border-blue-600 font-medium text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === 'kanban' && <Kanban project={project} reload={load} />}
      {tab === 'facade' && <Facade projectId={id} reload={load} />}
      {tab === 'reserves' && <Reserves projectId={id} />}
      {tab === 'photos' && <Photos projectId={id} />}
      {tab === 'documents' && <Documents projectId={id} />}
      {tab === 'synthese' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <h2 className="mb-3 font-semibold">Avancement par lot</h2>
            <div className="space-y-3">
              {project.lots.map((l) => (
                <div key={l.key}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span>{LOTS[l.key]}</span>
                    <span className="tabular-nums">{l.progress} %</span>
                  </div>
                  <ProgressBar value={l.progress} color="bg-emerald-500" />
                </div>
              ))}
            </div>
            <div className="mt-4 border-t border-slate-200 pt-3">
              <div className="flex justify-between font-semibold">
                <span>Avancement global</span>
                <span className="tabular-nums">{project.avancement} %</span>
              </div>
              <ProgressBar value={project.avancement} className="mt-1" />
            </div>
          </section>
          <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <h2 className="mb-3 font-semibold">Informations du marché</h2>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
              {INFO.map(([key, label]) => (
                <div key={key}>
                  <dt className="text-xs text-slate-500">{label}</dt>
                  <dd>{key.startsWith('date') ? fmtDate(project[key]) : project[key] || '—'}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      )}
    </div>
  );
}