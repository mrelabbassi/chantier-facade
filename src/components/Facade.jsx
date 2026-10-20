import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { inputCls } from './ui.jsx';
import { buildFacadeExport, readSpreadsheet } from '../lib/facadeSheet.js';

const STAGES = [
  ['statut_etude', 'Étude'],
  ['statut_approvisionnement', 'Appro.'],
  ['statut_fabrication', 'Fabrication'],
  ['statut_controle', 'Contrôle'],
  ['statut_livraison', 'Livraison'],
  ['statut_pose', 'Pose'],
];
const STATUS_CLS = {
  'À faire': 'bg-slate-100 text-slate-600',
  'En cours': 'bg-amber-100 text-amber-800',
  Fait: 'bg-emerald-100 text-emerald-800',
};
// Rôles qui ont la capacité facade.write côté serveur
const WRITE_ROLES = ['ADMIN', 'DIRECTEUR', 'CHEF_DE_PROJET', 'CONDUCTEUR', 'BUREAU_ETUDE', 'CHEF_EQUIPE'];
const TYPES = [
  'Fenêtre', 'Porte', 'Châssis', 'Coulissant', 'Façade vitrée', 'Mur-rideau', 'Verrière',
  'Garde-corps', 'Habillage aluminium', 'Alucobond', 'Tôle aluminium', 'Brise-soleil',
];
const EXPORTS = [
  ['xlsx', 'Excel (.xlsx)'],
  ['xls', 'Excel 97-2003 (.xls)'],
  ['csv', 'CSV (.csv)'],
];
const FIELDS = ['repere', 'type', 'systeme', 'largeur_mm', 'hauteur_mm', 'quantite', 'poids_kg', 'vitrage', 'ral', 'niveau', 'zone'];
const EMPTY = {
  repere: '', type: '', systeme: '', largeur_mm: '', hauteur_mm: '', quantite: '1',
  poids_kg: '', vitrage: '', ral: '', niveau: '', zone: '',
};
const TEMPLATE_HEADERS = ['repere', 'type', 'systeme', 'largeur_mm', 'hauteur_mm', 'quantite', 'poids_kg', 'vitrage', 'ral', 'niveau', 'zone'];
const LIMIT = 300;

const toForm = (row) => Object.fromEntries(
  FIELDS.map((k) => [k, row[k] == null ? (k === 'quantite' ? '1' : '') : String(row[k])]),
);
const sortRows = (list) => [...list].sort((a, b) => a.repere.localeCompare(b.repere, 'fr', { numeric: true }));

function downloadTemplate() {
  const sample = ['FA-001', 'Fenêtre', 'Série 50', '1200', '2000', '1', '', '4/16/4 Low-E', 'RAL 7016', 'R+1', 'Façade Nord'];
  const csv = `\uFEFF${[TEMPLATE_HEADERS.join(';'), sample.join(';')].join('\r\n')}\r\n`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'modele-elements-facade.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function ElementForm({ projectId, zones, initial, onSaved, onClose }) {
  const isEdit = !!initial;
  const [form, setForm] = useState(() => (isEdit ? toForm(initial) : EMPTY));
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const surface = form.largeur_mm && form.hauteur_mm
    ? (Number(form.largeur_mm) * Number(form.hauteur_mm)) / 1e6
    : null;

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      const saved = isEdit
        ? await api(`/facade-elements/${initial.id}`, { method: 'PATCH', body: form })
        : await api(`/projects/${projectId}/facade-elements`, { method: 'POST', body: form });
      onSaved(saved, isEdit);
      // Saisie en série : on garde le type, le niveau et la zone pour l'élément suivant
      if (!isEdit) setForm((f) => ({ ...EMPTY, type: f.type, niveau: f.niveau, zone: f.zone }));
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const field = (label, key, extra = {}) => (
    <label className="block space-y-1">
      <span className="text-xs text-slate-500">{label}</span>
      <input className={inputCls} value={form[key]} onChange={set(key)} {...extra} />
    </label>
  );

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">{isEdit ? `Modifier ${initial.repere}` : 'Nouvel élément de façade'}</h2>
        <button type="button" onClick={onClose} className="text-sm text-slate-500 hover:text-slate-800">
          Fermer
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {field('Repère *', 'repere', { required: true, autoFocus: true, placeholder: 'FA-026' })}
        {field('Type', 'type', { list: 'facade-types', placeholder: 'Fenêtre' })}
        {field('Système', 'systeme', { placeholder: 'ex. série 50 RT' })}
        {field('Niveau', 'niveau', { placeholder: 'R+1' })}
        {field('Zone', 'zone', { list: 'facade-zones' })}
        {field('Largeur (mm)', 'largeur_mm', { type: 'number', min: 0, inputMode: 'numeric' })}
        {field('Hauteur (mm)', 'hauteur_mm', { type: 'number', min: 0, inputMode: 'numeric' })}
        {field('Quantité', 'quantite', { type: 'number', min: 1, inputMode: 'numeric' })}
        {field('Poids (kg)', 'poids_kg', { type: 'number', min: 0, step: 'any' })}
        {field('Vitrage', 'vitrage', { placeholder: '4/16/4 Low-E' })}
        {field('RAL', 'ral', { placeholder: 'RAL 7016' })}
      </div>
      <datalist id="facade-types">
        {TYPES.map((t) => <option key={t} value={t} />)}
      </datalist>
      <datalist id="facade-zones">
        {zones.map((z) => <option key={z} value={z} />)}
      </datalist>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Enregistrement…' : isEdit ? 'Enregistrer' : "Ajouter l'élément"}
        </button>
        {surface !== null && <span className="text-sm text-slate-500">Surface : {surface.toFixed(2)} m²</span>}
        {formError && <span className="text-sm text-red-600">{formError}</span>}
      </div>
      {!isEdit && (
        <p className="text-xs text-slate-500">
          Après ajout, le formulaire garde le type, le niveau et la zone pour saisir l'élément suivant.
        </p>
      )}
    </form>
  );
}

function ImportPanel({ projectId, onDone, onClose }) {
  const [parsed, setParsed] = useState(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(null);
  const [err, setErr] = useState('');

  const pickFile = async (file) => {
    setErr('');
    setReport(null);
    setParsed(null);
    setFileName(file.name);
    try {
      const result = await readSpreadsheet(file);
      setParsed(result);
      if (!result.columns.includes('repere')) {
        setErr('Colonne « Repère » introuvable dans la première ligne du fichier.');
      } else if (!result.rows.length && !result.errors.length) {
        setErr('Aucune ligne exploitable : le repère doit être renseigné.');
      }
    } catch (e) {
      setErr(`Fichier illisible : ${e.message}`);
    }
  };

  const run = async () => {
    setBusy(true);
    setErr('');
    const total = { created: 0, updated: 0, serverErrors: 0 };
    try {
      const payload = parsed.rows.map(({ line, ...r }) => r);
      for (let i = 0; i < payload.length; i += 500) {
        const r = await api(`/projects/${projectId}/facade-elements/import`, {
          method: 'POST',
          body: { rows: payload.slice(i, i + 500) },
        });
        total.created += r.created;
        total.updated += r.updated;
        total.serverErrors += r.errors.length;
      }
      setReport(total);
      onDone();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Importer des éléments</h2>
        <button type="button" onClick={onClose} className="text-sm text-slate-500 hover:text-slate-800">
          Fermer
        </button>
      </div>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600">
        <li>Formats acceptés : <strong>Excel (.xlsx, .xls)</strong> et <strong>CSV</strong>.</li>
        <li>Colonnes reconnues : repère (obligatoire), type, système, niveau, zone, largeur, hauteur, quantité, poids, vitrage, RAL. Les en-têtes en français (« Largeur (mm) ») sont acceptés.</li>
        <li>Un repère déjà présent sur le chantier est <strong>mis à jour</strong> avec les colonnes du fichier. Une cellule vide ne modifie rien. Les statuts ne sont jamais changés par l'import.</li>
      </ol>
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="file"
          accept=".xlsx,.xls,.csv,text/csv"
          onChange={(e) => e.target.files[0] && pickFile(e.target.files[0])}
          className="text-sm"
        />
        <button type="button" onClick={downloadTemplate} className="text-sm text-blue-600 hover:underline">
          Télécharger le modèle CSV
        </button>
      </div>
      {parsed && parsed.rows.length > 0 && (
        <div className="space-y-2 text-sm">
          <p>
            {fileName} : <strong>{parsed.rows.length}</strong> ligne(s) prête(s)
            {parsed.ignored ? `, ${parsed.ignored} ignorée(s) sans repère` : ''}
            {parsed.errors.length ? `, ${parsed.errors.length} ligne(s) en erreur` : ''}.
            Colonnes trouvées : {parsed.columns.join(', ')}.
          </p>
          {parsed.errors.length > 0 && (
            <ul className="max-h-32 overflow-y-auto list-disc pl-5 text-xs text-red-700">
              {parsed.errors.slice(0, 50).map((e) => (
                <li key={`${e.line}-${e.error}`}>Ligne {e.line} : {e.error}</li>
              ))}
            </ul>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={run}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? 'Import en cours…' : `Importer ${parsed.rows.length} ligne(s)`}
          </button>
        </div>
      )}
      {report && (
        <p className="text-sm text-emerald-700">
          Import terminé : {report.created} créé(s), {report.updated} mis à jour
          {report.serverErrors ? `, ${report.serverErrors} refusé(s) par le serveur` : ''}.
        </p>
      )}
      {err && <p className="text-sm text-red-600">{err}</p>}
    </div>
  );
}

export default function Facade({ projectId, reload }) {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const [zone, setZone] = useState('');
  const [error, setError] = useState('');
  const [me, setMe] = useState(null);
  const [exporting, setExporting] = useState(false);
  // Export prêt : { url, name, count }. Le lien est cliqué par l'utilisateur.
  const [download, setDownload] = useState(null);
  // Libère l'URL de l'export précédent quand un nouvel export le remplace, ou au démontage
  useEffect(() => () => { if (download) URL.revokeObjectURL(download.url); }, [download]);
  // null | { kind: 'add' } | { kind: 'edit', row } | { kind: 'import' }
  const [panel, setPanel] = useState(null);

  const refreshRows = () => api(`/projects/${projectId}/facade-elements`).then((list) => setRows(sortRows(list)));

  useEffect(() => {
    refreshRows().catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    api('/auth/me').then(setMe).catch(() => {});
  }, []);

  const canWrite = !!me && WRITE_ROLES.includes(me.role);
  const zones = useMemo(() => [...new Set((rows ?? []).map((r) => r.zone).filter(Boolean))].sort(), [rows]);
  const filtered = useMemo(
    () =>
      (rows ?? []).filter(
        (r) =>
          (!q || r.repere.toLowerCase().includes(q.trim().toLowerCase())) && (!zone || r.zone === zone),
      ),
    [rows, q, zone],
  );
  const surface = filtered.reduce((s, r) => s + r.surface_m2, 0);

  const onSaved = (row, edited) => {
    setRows((rs) => sortRows(edited ? rs.map((r) => (r.id === row.id ? row : r)) : [...(rs ?? []), row]));
    if (edited) setPanel(null);
    reload?.();
  };

  const remove = async (row) => {
    if (!window.confirm(`Supprimer l'élément ${row.repere} ? Cette action est définitive.`)) return;
    try {
      await api(`/facade-elements/${row.id}`, { method: 'DELETE' });
      setRows((rs) => rs.filter((r) => r.id !== row.id));
      reload?.();
    } catch (e) {
      setError(e.message);
    }
  };

  const setStatus = async (row, col, value) => {
    const prev = rows;
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, [col]: value } : r)));
    try {
      const updated = await api(`/facade-elements/${row.id}`, { method: 'PATCH', body: { [col]: value } });
      setRows((rs) => rs.map((r) => (r.id === row.id ? updated : r)));
    } catch (e) {
      setRows(prev);
      setError(e.message);
    }
  };

  // Exporte la liste telle qu'elle est filtrée à l'écran
  const doExport = async (format) => {
    setExporting(true);
    setError('');
    try {
      const { blob, name } = await buildFacadeExport(filtered, format, `elements-facade-${new Date().toISOString().slice(0, 10)}`);
      setDownload({ url: URL.createObjectURL(blob), name, count: filtered.length });
    } catch (e) {
      setError(`Export impossible : ${e.message}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className={`${inputCls} max-w-xs`}
          placeholder="Filtrer par repère (ex. FA-025)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className={`${inputCls} w-auto`} value={zone} onChange={(e) => setZone(e.target.value)}>
          <option value="">Toutes les zones</option>
          {zones.map((z) => <option key={z}>{z}</option>)}
        </select>
        <span className="text-sm text-slate-500">{filtered.length} élément(s) · {surface.toFixed(0)} m²</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500">Exporter :</span>
          {EXPORTS.map(([fmt, label]) => (
            <button
              key={fmt}
              type="button"
              disabled={exporting || !filtered.length}
              onClick={() => doExport(fmt)}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {label}
            </button>
          ))}
          {canWrite && (
            <>
              <button
                type="button"
                onClick={() => setPanel({ kind: 'import' })}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Importer
              </button>
              <button
                type="button"
                onClick={() => setPanel({ kind: 'add' })}
                className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                + Ajouter un élément
              </button>
            </>
          )}
        </div>
      </div>

      {download && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900 ring-1 ring-emerald-200">
          <span>Export prêt : {download.count} élément(s).</span>
          <a href={download.url} download={download.name} className="font-medium underline">
            Télécharger {download.name}
          </a>
          <button type="button" onClick={() => window.open(download.url, '_blank')} className="text-xs underline">
            Ouvrir dans un nouvel onglet
          </button>
          <button type="button" onClick={() => setDownload(null)} className="ml-auto text-xs text-emerald-700">
            Fermer
          </button>
        </div>
      )}
      {panel?.kind === 'add' && (
        <ElementForm key="new" projectId={projectId} zones={zones} onSaved={onSaved} onClose={() => setPanel(null)} />
      )}
      {panel?.kind === 'edit' && (
        <ElementForm
          key={panel.row.id}
          projectId={projectId}
          zones={zones}
          initial={panel.row}
          onSaved={onSaved}
          onClose={() => setPanel(null)}
        />
      )}
      {panel?.kind === 'import' && (
        <ImportPanel projectId={projectId} onDone={() => { refreshRows(); reload?.(); }} onClose={() => setPanel(null)} />
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {!rows ? (
        <p className="text-slate-500">Chargement…</p>
      ) : rows.length === 0 ? (
        <p className="text-slate-500">
          Aucun élément de façade sur ce chantier.{canWrite ? ' Ajoutez le premier élément ou importez un fichier Excel ou CSV.' : ''}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Repère</th>
                <th className="px-2 py-2">Type</th>
                <th className="px-2 py-2">Système</th>
                <th className="px-2 py-2">L × H (mm)</th>
                <th className="px-2 py-2 text-right">Surface m²</th>
                <th className="px-2 py-2">Niveau</th>
                <th className="px-2 py-2">Zone</th>
                {STAGES.map(([col, label]) => <th key={col} className="px-2 py-2">{label}</th>)}
                {canWrite && <th className="px-2 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.slice(0, LIMIT).map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="whitespace-nowrap px-3 py-2 font-mono font-medium">{r.repere}</td>
                  <td className="whitespace-nowrap px-2 py-2">{r.type}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-slate-600">{r.systeme}</td>
                  <td className="whitespace-nowrap px-2 py-2">{r.largeur_mm} × {r.hauteur_mm}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.surface_m2.toFixed(2)}</td>
                  <td className="whitespace-nowrap px-2 py-2">{r.niveau}</td>
                  <td className="whitespace-nowrap px-2 py-2">{r.zone}</td>
                  {STAGES.map(([col]) => (
                    <td key={col} className="px-2 py-1">
                      <select
                        value={r[col]}
                        disabled={!canWrite}
                        onChange={(e) => setStatus(r, col, e.target.value)}
                        className={`rounded px-1.5 py-1 text-xs font-medium disabled:opacity-100 ${STATUS_CLS[r[col]] ?? ''}`}
                      >
                        {Object.keys(STATUS_CLS).map((s) => <option key={s}>{s}</option>)}
                      </select>
                    </td>
                  ))}
                  {canWrite && (
                    <td className="whitespace-nowrap px-2 py-1 text-right">
                      <button
                        type="button"
                        onClick={() => setPanel({ kind: 'edit', row: r })}
                        className="px-2 py-1 text-xs text-blue-600 hover:underline"
                      >
                        Modifier
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(r)}
                        className="px-2 py-1 text-xs text-red-600 hover:underline"
                      >
                        Supprimer
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {filtered.length > LIMIT && (
        <p className="text-xs text-slate-500">Affichage des {LIMIT} premiers éléments : affinez la recherche. L'export contient tous les éléments filtrés.</p>
      )}
    </div>
  );
}