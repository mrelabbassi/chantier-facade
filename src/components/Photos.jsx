import { useEffect, useMemo, useState } from 'react';
import { api, upload } from '../api.js';
import { Badge, Field, fmtDate, inputCls } from './ui.jsx';

const PHOTO_CATEGORIES = ['Avant travaux', 'Pendant travaux', 'Après travaux', 'Défaut', 'Réserve', 'Contrôle', 'Réception'];
const CAT_CLS = {
  'Avant travaux': 'bg-slate-100 text-slate-700',
  'Pendant travaux': 'bg-sky-100 text-sky-700',
  'Après travaux': 'bg-emerald-100 text-emerald-700',
  Défaut: 'bg-red-100 text-red-700',
  Réserve: 'bg-amber-100 text-amber-800',
  Contrôle: 'bg-violet-100 text-violet-700',
  Réception: 'bg-blue-100 text-blue-700',
};

export default function Photos({ projectId }) {
  const [rows, setRows] = useState(null);
  const [filter, setFilter] = useState('');
  const [meta, setMeta] = useState({ category: 'Pendant travaux', zone: '', niveau: '', repere: '', comment: '' });
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(null);

  const load = () => api(`/projects/${projectId}/photos`).then(setRows).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [projectId]);

  const onFiles = async (e) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    if (!files.length) return;
    setError('');
    let done = 0;
    try {
      for (const file of files) {
        setProgress(`Envoi ${done + 1} / ${files.length}…`);
        await upload(`/projects/${projectId}/photos`, file, meta);
        done += 1;
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setProgress('');
      load();
    }
  };

  const remove = async (p) => {
    if (!window.confirm('Supprimer cette photo ?')) return;
    try {
      await api(`/photos/${p.id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const shown = useMemo(() => (rows ?? []).filter((p) => !filter || p.category === filter), [rows, filter]);
  const set = (k) => (e) => setMeta((m) => ({ ...m, [k]: e.target.value }));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:grid-cols-3">
        <Field label="Catégorie">
          <select className={inputCls} value={meta.category} onChange={set('category')}>
            {PHOTO_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Zone"><input className={inputCls} value={meta.zone} onChange={set('zone')} placeholder="Façade Nord" /></Field>
        <Field label="Niveau"><input className={inputCls} value={meta.niveau} onChange={set('niveau')} placeholder="R+3" /></Field>
        <Field label="Repère"><input className={inputCls} value={meta.repere} onChange={set('repere')} placeholder="FA-025" /></Field>
        <div className="sm:col-span-2">
          <Field label="Commentaire"><input className={inputCls} value={meta.comment} onChange={set('comment')} /></Field>
        </div>
        <div className="flex flex-wrap items-end gap-2 sm:col-span-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
            📷 Prendre une photo
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={onFiles} />
          </label>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
            🖼 Choisir dans la galerie
            <input type="file" accept="image/*" multiple className="hidden" onChange={onFiles} />
          </label>
          {progress && <span className="text-sm text-slate-500">{progress}</span>}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <select className={`${inputCls} w-auto`} value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">Toutes les catégories</option>
          {PHOTO_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
        <span className="text-sm text-slate-500">{shown.length} photo(s)</span>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}

      {!rows ? (
        <p className="text-slate-500">Chargement…</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-slate-500">Aucune photo pour le moment.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {shown.map((p) => (
            <figure key={p.id} className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
              <button type="button" onClick={() => setZoom(p)} className="block w-full">
                <img src={`/api/files/${p.file_id}`} alt={p.comment || p.category} loading="lazy" className="h-40 w-full object-cover" />
              </button>
              <figcaption className="space-y-1 p-2 text-xs">
                <Badge className={CAT_CLS[p.category] ?? 'bg-slate-100'}>{p.category}</Badge>
                <p className="font-mono text-slate-700">{[p.repere, p.zone, p.niveau].filter(Boolean).join(' · ') || '—'}</p>
                {p.comment && <p className="text-slate-600">{p.comment}</p>}
                <p className="text-slate-400">{p.author_name ?? '—'} · {fmtDate(p.created_at.slice(0, 10))}</p>
                <button onClick={() => remove(p)} className="text-red-600 hover:underline">Supprimer</button>
              </figcaption>
            </figure>
          ))}
        </div>
      )}

      {zoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 p-4" onClick={() => setZoom(null)}>
          <img src={`/api/files/${zoom.file_id}`} alt="" className="max-h-full max-w-full rounded-lg" />
        </div>
      )}
    </div>
  );
}