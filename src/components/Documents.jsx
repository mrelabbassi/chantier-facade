import { Fragment, useEffect, useState } from 'react';
import { api, upload } from '../api.js';
import { Field, btnCls, fmtDate, inputCls } from './ui.jsx';

const DOC_CATEGORIES = [
  "Plans architecte", "Plans d'exécution", 'Plans de fabrication', 'Plans de pose', 'Notes de calcul',
  'Fiches techniques', 'Fiches matériaux', 'PV', 'DOE', 'Photos', 'Courriers', 'Emails', 'Devis', 'Commandes',
];
const DOC_STATUSES = ['Brouillon', 'En validation', 'Validé', 'Archivé'];
const STATUS_CLS = {
  Brouillon: 'bg-slate-100 text-slate-600',
  'En validation': 'bg-amber-100 text-amber-800',
  Validé: 'bg-emerald-100 text-emerald-800',
  Archivé: 'bg-slate-200 text-slate-500',
};

export default function Documents({ projectId }) {
  const [rows, setRows] = useState(null);
  const [filter, setFilter] = useState('');
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState(DOC_CATEGORIES[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(null);

  const load = () => api(`/projects/${projectId}/documents`).then(setRows).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [projectId]);

  const pickFile = (e) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ''));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!file) return;
    const formEl = e.currentTarget;
    setBusy(true);
    setError('');
    try {
      await upload(`/projects/${projectId}/documents`, file, { title: title.trim() || file.name, category });
      setFile(null);
      setTitle('');
      formEl.reset();
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (d, status) => {
    try {
      await api(`/documents/${d.id}`, { method: 'PATCH', body: { status } });
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const shown = (rows ?? []).filter((d) => !filter || d.category === filter);

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="grid gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:grid-cols-4">
        <Field label="Fichier (PDF, image, Excel, DWG…)">
          <input
            type="file"
            required
            onChange={pickFile}
            className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2"
          />
        </Field>
        <Field label="Titre (même titre = nouvelle version)">
          <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Catégorie">
          <select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)}>
            {DOC_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <div className="flex items-end">
          <button className={`${btnCls} w-full`} disabled={busy || !file}>{busy ? 'Envoi…' : 'Ajouter'}</button>
        </div>
      </form>

      <div className="flex items-center justify-between gap-2">
        <select className={`${inputCls} w-auto`} value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">Toutes les catégories</option>
          {DOC_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
        <span className="text-sm text-slate-500">{shown.length} document(s)</span>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}

      {!rows ? (
        <p className="text-slate-500">Chargement…</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-slate-500">Aucun document pour le moment.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Document</th>
                <th className="px-2 py-2">Catégorie</th>
                <th className="px-2 py-2">Version</th>
                <th className="px-2 py-2">Date</th>
                <th className="px-2 py-2">Auteur</th>
                <th className="px-2 py-2">Statut</th>
                <th className="px-2 py-2">Fichier</th>
                <th className="px-2 py-2">Commentaires</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((d) => (
                <Fragment key={d.id}>
                  <tr className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-medium">{d.title}</td>
                    <td className="whitespace-nowrap px-2 py-2">{d.category}</td>
                    <td className="px-2 py-2 tabular-nums">v{d.version}</td>
                    <td className="whitespace-nowrap px-2 py-2">{fmtDate(d.created_at.slice(0, 10))}</td>
                    <td className="whitespace-nowrap px-2 py-2">{d.author_name ?? '—'}</td>
                    <td className="px-2 py-1">
                      <select
                        value={d.status}
                        onChange={(e) => setStatus(d, e.target.value)}
                        className={`rounded px-1.5 py-1 text-xs font-medium ${STATUS_CLS[d.status] ?? ''}`}
                      >
                        {DOC_STATUSES.map((s) => <option key={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-2">
                      <a href={`/api/files/${d.file_id}?download=1`} className="text-blue-600 hover:underline">{d.file_name}</a>
                    </td>
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        onClick={() => setOpenId(openId === d.id ? null : d.id)}
                        className="text-blue-600 hover:underline"
                      >
                        💬 {d.comments_count}
                      </button>
                    </td>
                  </tr>
                  {openId === d.id && (
                    <tr>
                      <td colSpan={8} className="bg-slate-50 px-3 py-3">
                        <DocComments documentId={d.id} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DocComments({ documentId }) {
  const [list, setList] = useState(null);
  const [text, setText] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    api(`/documents/${documentId}/comments`).then(setList).catch((e) => setErr(e.message));
  }, [documentId]);

  const add = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    try {
      const c = await api(`/documents/${documentId}/comments`, { method: 'POST', body: { body: text } });
      setList((l) => [...(l ?? []), c]);
      setText('');
    } catch (ex) {
      setErr(ex.message);
    }
  };

  return (
    <div className="space-y-2">
      {err && <p className="text-sm text-red-600">{err}</p>}
      {!list ? (
        <p className="text-sm text-slate-500">Chargement…</p>
      ) : list.length === 0 ? (
        <p className="text-sm text-slate-500">Aucun commentaire.</p>
      ) : (
        <ul className="space-y-1">
          {list.map((c) => (
            <li key={c.id} className="text-sm">
              <strong>{c.author_name ?? 'Inconnu'}</strong>{' '}
              <span className="text-xs text-slate-400">{new Date(c.created_at).toLocaleString('fr-FR')}</span>
              <p className="whitespace-pre-wrap">{c.body}</p>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="flex gap-2">
        <input className={inputCls} placeholder="Commenter ce document" value={text} onChange={(e) => setText(e.target.value)} />
        <button className={btnCls}>Envoyer</button>
      </form>
    </div>
  );
}