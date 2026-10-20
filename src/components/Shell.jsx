import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { inputCls } from './ui.jsx';

function SearchBox() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);

  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      return undefined;
    }
    const t = setTimeout(() => {
      api(`/search?q=${encodeURIComponent(q.trim())}`).then(setResults).catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const hrefFor = (r) => (r.kind === 'chantier' ? `#/projects/${r.id}` : r.project_id ? `#/projects/${r.project_id}` : null);

  return (
    <div className="relative order-last w-full sm:order-none sm:w-72">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Rechercher un chantier, repère (FA-025), tâche…"
        className={inputCls}
      />
      {results.length > 0 && (
        <ul className="absolute z-50 mt-1 max-h-80 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {results.map((r) => {
            const href = hrefFor(r);
            const label = (
              <>
                <span className="text-xs uppercase text-slate-400">{r.kind}</span>
                <span className="ml-2 text-sm">{r.title}</span>
              </>
            );
            return (
              <li key={`${r.kind}-${r.id}`}>
                {href ? (
                  <a href={href} onClick={() => setQ('')} className="block px-3 py-2 hover:bg-slate-50">{label}</a>
                ) : (
                  <div className="px-3 py-2 text-slate-500">{label}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function Header({ user, page, onLogout }) {
  const links = [
    ...(user.role !== 'POSEUR' ? [['dashboard', 'Tableau de bord']] : []),
    ['projects', 'Chantiers'],
    ...(['ADMIN', 'DIRECTEUR', 'CHEF_DE_PROJET', 'CONDUCTEUR'].includes(user.role) ? [['crm', 'CRM']] : []),
    ...(user.role === 'ADMIN' ? [['utilisateurs', 'Utilisateurs']] : []),
  ];
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-3 py-2 sm:px-6">
        <a href="#/dashboard" className="flex items-center gap-2 font-semibold text-slate-900">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-blue-600 text-white">▦</span>
          Chantier<span className="text-blue-600">Façade</span>
        </a>
        <nav className="flex gap-1">
          {links.map(([key, label]) => (
            <a
              key={key}
              href={`#/${key}`}
              className={`rounded-lg px-3 py-1.5 text-sm ${page === key ? 'bg-blue-50 font-medium text-blue-700' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              {label}
            </a>
          ))}
        </nav>
        <SearchBox />
        <div className="ml-auto flex items-center gap-2 text-sm">
          <span className="hidden text-slate-600 sm:inline">{user.name}</span>
          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{user.role}</span>
          <button type="button" onClick={onLogout} className="ml-1 rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100">Déconnexion</button>
        </div>
      </div>
    </header>
  );
}