import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { ProgressBar, fmtMAD } from './ui.jsx';

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/dashboard').then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="text-red-600">{error}</p>;
  if (!data) return <p className="text-slate-500">Chargement…</p>;

  const kpis = [
    ['Chantiers en cours', data.chantiers_en_cours],
    ['Chantiers terminés', data.chantiers_termines],
    ['Tâches en retard', data.taches_en_retard, 'text-red-600'],
    ['Tâches du jour', data.taches_du_jour],
    ['Tâches prioritaires', data.taches_prioritaires, 'text-orange-600'],
    ['Avancement moyen', `${data.avancement_moyen} %`],
    ['Réserves ouvertes', data.reserves_ouvertes, 'text-amber-600'],
  ];
  const maxBudget = Math.max(1, ...data.chantiers.map((c) => c.budget ?? 0));

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Tableau de bord</h1>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map(([label, value, cls = '']) => (
          <div key={label} className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <p className="text-xs text-slate-500">{label}</p>
            <p className={`mt-1 text-2xl font-semibold tabular-nums ${cls}`}>{value}</p>
          </div>
        ))}
      </div>

      <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h2 className="mb-3 font-semibold">{data.finance ? 'Avancement et budget par chantier' : 'Avancement par chantier'}</h2>
        <div className="space-y-3">
          {data.chantiers.map((c) => (
            <a key={c.id} href={`#/projects/${c.id}`} className="block rounded-lg p-2 hover:bg-slate-50">
              <div className="mb-1 flex justify-between text-sm">
                <span className="font-medium">{c.name}</span>
                <span className="tabular-nums">{c.avancement} %</span>
              </div>
              <ProgressBar value={c.avancement} />
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-slate-100">
                <div className="h-full rounded bg-slate-400" style={{ width: `${data.finance ? (c.budget / maxBudget) * 100 : c.avancement}%` }} />
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {data.finance && <>Budget {fmtMAD(c.budget)} · </>} {c.tasks_late} tâche(s) en retard · {c.reserves_open} réserve(s) ouverte(s)
              </p>
            </a>
          ))}
        </div>
      </section>

      <p className="text-xs text-slate-500">
        Commandes, coûts de main-d'œuvre, matériaux consommés, heures travaillées et livraisons en attente
        arriveront avec les modules Stock/Achats et Suivi des heures (phase 2).
      </p>
    </div>
  );
}