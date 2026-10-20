// Import et export des éléments de façade au format CSV, XLS et XLSX.
// Module sans React : utilisé par l'interface et par les tests (scripts/smoke.mjs).
// SheetJS (xlsx) n'est chargé qu'à la demande, pour ne pas alourdir le premier affichage.

export const FACADE_COLUMNS = [
  { key: 'repere', label: 'Repère' },
  { key: 'type', label: 'Type' },
  { key: 'systeme', label: 'Système' },
  { key: 'niveau', label: 'Niveau' },
  { key: 'zone', label: 'Zone' },
  { key: 'largeur_mm', label: 'Largeur (mm)' },
  { key: 'hauteur_mm', label: 'Hauteur (mm)' },
  { key: 'surface_m2', label: 'Surface (m²)' },
  { key: 'quantite', label: 'Quantité' },
  { key: 'poids_kg', label: 'Poids (kg)' },
  { key: 'vitrage', label: 'Vitrage' },
  { key: 'ral', label: 'RAL' },
  { key: 'statut_etude', label: 'Étude' },
  { key: 'statut_approvisionnement', label: 'Appro.' },
  { key: 'statut_fabrication', label: 'Fabrication' },
  { key: 'statut_controle', label: 'Contrôle' },
  { key: 'statut_livraison', label: 'Livraison' },
  { key: 'statut_pose', label: 'Pose' },
];

// Champs importables. Les statuts et la surface ne sont jamais importés.
const IMPORT_FIELDS = ['repere', 'type', 'systeme', 'niveau', 'zone', 'largeur_mm', 'hauteur_mm', 'quantite', 'poids_kg', 'vitrage', 'ral'];
const NUMERIC_FIELDS = ['largeur_mm', 'hauteur_mm', 'quantite', 'poids_kg'];

// En-tête → nom normalisé : accents, contenu entre parenthèses (unités) et ponctuation retirés
const normHeader = (s) => String(s ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/\([^)]*\)/g, ' ')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '');

const ALIAS = {
  repere: 'repere',
  type: 'type',
  systeme: 'systeme',
  niveau: 'niveau',
  zone: 'zone',
  largeur: 'largeur_mm', largeur_mm: 'largeur_mm',
  hauteur: 'hauteur_mm', hauteur_mm: 'hauteur_mm',
  quantite: 'quantite', qte: 'quantite',
  poids: 'poids_kg', poids_kg: 'poids_kg',
  vitrage: 'vitrage',
  ral: 'ral',
};

const toNumber = (v) => {
  if (typeof v === 'number') return v;
  return Number(String(v).trim().replace(/\s/g, '').replace(',', '.'));
};

// Table = tableau de lignes (première ligne = en-têtes). Ne lit que les colonnes reconnues.
export function parseFacadeTable(table) {
  const lines = (table ?? []).map((r) => (Array.isArray(r) ? r : []));
  const result = { rows: [], errors: [], ignored: 0, columns: [] };
  if (!lines.length) return result;

  const idx = {};
  lines[0].forEach((h, i) => {
    const key = ALIAS[normHeader(h)];
    if (key && idx[key] === undefined) {
      idx[key] = i;
      result.columns.push(key);
    }
  });
  if (idx.repere === undefined) return result;

  lines.slice(1).forEach((cells, n) => {
    const line = n + 2; // numéro de ligne dans le fichier (en-tête = ligne 1)
    const cell = (k) => (idx[k] === undefined ? '' : cells[idx[k]]);
    const repere = String(cell('repere') ?? '').trim();
    const hasOther = cells.some((c) => String(c ?? '').trim() !== '');
    if (!repere) {
      if (hasOther) result.ignored++;
      return;
    }
    const row = { line, repere };
    for (const k of IMPORT_FIELDS) {
      if (k === 'repere' || idx[k] === undefined) continue;
      const raw = cell(k);
      // Cellule vide = champ non modifié (un repère existant garde sa valeur)
      if (raw == null || String(raw).trim() === '') continue;
      if (NUMERIC_FIELDS.includes(k)) {
        const value = toNumber(raw);
        if (!Number.isFinite(value)) {
          result.errors.push({ line, error: `${k} : valeur numérique invalide (« ${raw} »)` });
          return; // la ligne est ignorée
        }
        row[k] = value;
      } else {
        row[k] = String(raw).trim();
      }
    }
    result.rows.push(row);
  });
  return result;
}

// Lecture CSV : séparateur détecté (; , ou tabulation), guillemets gérés, BOM Excel ignoré
export function parseCsvText(text) {
  const src = String(text).replace(/^\uFEFF/, '');
  const firstLine = src.split(/\r?\n/)[0] ?? '';
  const delim = [';', ',', '\t']
    .map((d) => [d, firstLine.split(d).length])
    .sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') {
      quoted = true;
    } else if (c === delim) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

// Lit un fichier choisi par l'utilisateur (.csv, .xls, .xlsx) et renvoie les lignes à importer
export async function readSpreadsheet(file) {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
    return parseFacadeTable(parseCsvText(await file.text()));
  }
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return parseFacadeTable([]);
  return parseFacadeTable(XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true }));
}

// Tableau à écrire : en-têtes en français, une ligne par élément
export function facadeToAoa(rows) {
  const header = FACADE_COLUMNS.map((c) => c.label);
  const body = rows.map((r) => FACADE_COLUMNS.map(({ key }) => {
    const v = r[key];
    return typeof v === 'number' ? Math.round(v * 100) / 100 : (v ?? '');
  }));
  return [header, ...body];
}

// Construit le fichier d'export en mémoire, sans le télécharger.
// Le téléchargement est déclenché par l'interface, par un lien que l'utilisateur clique :
// un téléchargement lancé par script est bloqué dans certains contextes (iframe d'artefact).
// format : 'xlsx' | 'xls' | 'csv'  →  { blob, name }
export async function buildFacadeExport(rows, format, baseName) {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.aoa_to_sheet(facadeToAoa(rows));
  ws['!cols'] = FACADE_COLUMNS.map((c) => ({ wch: Math.max(10, c.label.length + 2) }));
  if (format === 'csv') {
    // Point-virgule et BOM : Excel en français ouvre le fichier directement
    const csv = XLSX.utils.sheet_to_csv(ws, { FS: ';' });
    return { blob: new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }), name: `${baseName}.csv` };
  }
  if (format !== 'xlsx' && format !== 'xls') throw new Error(`Format non pris en charge : ${format}`);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Elements facade');
  const bytes = XLSX.write(wb, { type: 'array', bookType: format });
  const mime = format === 'xls'
    ? 'application/vnd.ms-excel'
    : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  return { blob: new Blob([bytes], { type: mime }), name: `${baseName}.${format}` };
}