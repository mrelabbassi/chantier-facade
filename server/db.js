import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(ROOT, 'data'), { recursive: true });

export const db = new DatabaseSync(join(ROOT, 'data', 'chantier.db'));
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  fonction TEXT,
  phone TEXT,
  equipe TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  client TEXT,
  maitre_ouvrage TEXT,
  architecte TEXT,
  bureau_etudes TEXT,
  bureau_controle TEXT,
  entreprise_generale TEXT,
  adresse TEXT,
  responsable_id TEXT REFERENCES users(id),
  chef_projet_id TEXT REFERENCES users(id),
  date_debut TEXT,
  date_fin_prevue TEXT,
  budget REAL NOT NULL DEFAULT 0,
  surface_facade REAL NOT NULL DEFAULT 0,
  surface_menuiserie REAL NOT NULL DEFAULT 0,
  nombre_elements INTEGER NOT NULL DEFAULT 0,
  statut TEXT NOT NULL DEFAULT 'Prospection',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS kanban_columns (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  column_id TEXT NOT NULL REFERENCES kanban_columns(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  repere TEXT,
  zone TEXT,
  assignee_id TEXT REFERENCES users(id),
  priority TEXT NOT NULL DEFAULT 'Normale',
  due_date TEXT,
  progress INTEGER NOT NULL DEFAULT 0,
  position REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS subtasks (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id TEXT REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS facade_elements (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  repere TEXT NOT NULL,
  type TEXT,
  systeme TEXT,
  largeur_mm INTEGER,
  hauteur_mm INTEGER,
  surface_m2 REAL NOT NULL DEFAULT 0,
  poids_kg REAL,
  vitrage TEXT,
  ral TEXT,
  quantite INTEGER NOT NULL DEFAULT 1,
  niveau TEXT,
  zone TEXT,
  statut_etude TEXT NOT NULL DEFAULT 'À faire',
  statut_approvisionnement TEXT NOT NULL DEFAULT 'À faire',
  statut_fabrication TEXT NOT NULL DEFAULT 'À faire',
  statut_controle TEXT NOT NULL DEFAULT 'À faire',
  statut_livraison TEXT NOT NULL DEFAULT 'À faire',
  statut_pose TEXT NOT NULL DEFAULT 'À faire',
  UNIQUE (project_id, repere)
);
CREATE TABLE IF NOT EXISTS reserves (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  numero INTEGER NOT NULL,
  zone TEXT,
  repere TEXT,
  description TEXT NOT NULL,
  responsable_id TEXT REFERENCES users(id),
  priority TEXT NOT NULL DEFAULT 'Normale',
  date_limite TEXT,
  statut TEXT NOT NULL DEFAULT 'Ouverte',
  created_at TEXT NOT NULL
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'En validation',
  file_id TEXT NOT NULL REFERENCES files(id),
  author_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS document_comments (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  author_id TEXT REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL REFERENCES files(id),
  category TEXT NOT NULL,
  zone TEXT,
  niveau TEXT,
  repere TEXT,
  comment TEXT,
  author_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL
);
`);

export const now = () => new Date().toISOString();
export const uid = () => randomUUID();
export const isoDate = (offsetDays = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

export function hashPassword(pw) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(pw, salt, 64).toString('hex')}`;
}

export function verifyPassword(pw, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const a = Buffer.from(hash, 'hex');
  const b = scryptSync(pw, salt, 64);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const COLUMNS = ['À faire', 'Étude', 'Validation', 'Approvisionnement', 'Fabrication', 'Livraison', 'Pose', 'Contrôle', 'Réserves', 'Terminé'];

export const PROJECT_FIELDS = [
  'name', 'client', 'maitre_ouvrage', 'architecte', 'bureau_etudes', 'bureau_controle',
  'entreprise_generale', 'adresse', 'responsable_id', 'chef_projet_id', 'date_debut',
  'date_fin_prevue', 'budget', 'surface_facade', 'surface_menuiserie', 'nombre_elements', 'statut',
];
const PROJECT_DEFAULTS = { budget: 0, surface_facade: 0, surface_menuiserie: 0, nombre_elements: 0, statut: 'Prospection' };

export function insertProject(data) {
  const id = uid();
  const cols = ['id', 'created_at', ...PROJECT_FIELDS];
  const vals = [id, now(), ...PROJECT_FIELDS.map((f) => data[f] ?? PROJECT_DEFAULTS[f] ?? null)];
  db.prepare(`INSERT INTO projects (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...vals);
  COLUMNS.forEach((name, position) =>
    db.prepare('INSERT INTO kanban_columns (id, project_id, name, position) VALUES (?, ?, ?, ?)').run(uid(), id, name, position),
  );
  return id;
}

function seedDemo() {
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) return;

  db.exec('BEGIN');
  try {
    const pw = hashPassword('demo1234');
    const ins = db.prepare('INSERT INTO users (id, name, email, password_hash, role, fonction, phone, equipe) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const people = {
      karim: ['Karim Benjelloun', 'karim@demo.ma', 'DIRECTEUR', 'Directeur général', '+212 6 00 00 00 01', 'Direction'],
      sara: ['Sara Alaoui', 'sara@demo.ma', 'CHEF_DE_PROJET', 'Cheffe de projet', '+212 6 00 00 00 02', 'Direction'],
      youssef: ['Youssef Tazi', 'youssef@demo.ma', 'CONDUCTEUR', 'Conducteur de travaux', '+212 6 00 00 00 03', 'Pose'],
      nadia: ['Nadia Chraibi', 'nadia@demo.ma', 'BUREAU_ETUDE', 'Ingénieur BE', '+212 6 00 00 00 04', "Bureau d'études"],
      hicham: ['Hicham Berrada', 'hicham@demo.ma', 'CHEF_EQUIPE', 'Responsable atelier', '+212 6 00 00 00 05', 'Fabrication'],
      ahmed: ['Ahmed Bennani', 'ahmed@demo.ma', 'CHEF_EQUIPE', "Chef d'équipe pose", '+212 6 00 00 00 06', 'Pose'],
      omar: ['Omar Idrissi', 'omar@demo.ma', 'POSEUR', 'Poseur', '+212 6 00 00 00 07', 'Pose'],
      admin: ['Admin Démo', 'admin@demo.ma', 'ADMIN', 'Administrateur', '+212 6 00 00 00 08', 'Direction'],
      client: ['Client Démo', 'client@demo.ma', 'CLIENT', "Maître d'ouvrage", '+212 6 00 00 00 09', 'Externe'],
    };
    const U = {};
    for (const [key, [name, email, role, fonction, phone, equipe]] of Object.entries(people)) {
      U[key] = uid();
      ins.run(U[key], name, email, pw, role, fonction, phone, equipe);
    }

    const N = 600;
    const P = insertProject({
      name: 'Résidence Rabat – Façade aluminium',
      client: 'Promoteur Atlas Immobilier',
      maitre_ouvrage: 'SCI Rabat Marina',
      architecte: 'Cabinet Architectes Associés',
      bureau_etudes: 'BET Façades Ingénierie',
      bureau_controle: 'Socotec Maroc',
      entreprise_generale: 'Groupe BTP Maghreb',
      adresse: 'Rue des Oliviers, Hay Riad, Rabat',
      responsable_id: U.youssef,
      chef_projet_id: U.sara,
      date_debut: isoDate(-45),
      date_fin_prevue: isoDate(120),
      budget: 2450000,
      surface_facade: 5000,
      surface_menuiserie: 3200,
      nombre_elements: N,
      statut: 'Fabrication',
    });

    const cols = db.prepare('SELECT id, position FROM kanban_columns WHERE project_id = ? ORDER BY position').all(P);

    const T = [
      [0, 'Relevé de cotes sur site – façade Nord', 'FA-001 à FA-040', 'Façade Nord', 'youssef', 'Haute', -2, 0, ['Relevé niveau R+1', 'Relevé niveau R+2', 'Contrôle des feuillures']],
      [1, "Plans d'exécution – meneaux et traverses", 'FA-001 à FA-040', 'Façade Nord', 'nadia', 'Haute', 3, 60, ['Coupes types', "Détails d'angle", 'Plans de pose']],
      [2, "Validation des plans par l'architecte", 'Tous', 'Global', 'sara', 'Haute', 5, 0, ['Envoi des plans', 'Retour de visa']],
      [3, 'Commande profilés et vitrages – lot 1', 'FA-001 à FA-020', 'Global', 'hicham', 'Normale', 4, 50, []],
      [4, 'Fabrication FA-001 à FA-010', 'FA-001 à FA-010', 'Façade Nord', 'hicham', 'Haute', 10, 80, ['Coupe et usinage', 'Assemblage', 'Vitrage']],
      [5, 'Livraison lot 1 – façade Nord', 'FA-001 à FA-020', 'Façade Nord', 'youssef', 'Normale', 2, 0, []],
      [6, 'Pose MC-001 niveau R+1', 'MC-001', 'Façade Sud', 'ahmed', 'Normale', 7, 40, ['Ancrages', 'Montage traverses', 'Joints']],
      [7, "Essai d'étanchéité à l'eau – FA-001 à FA-010", 'FA-001 à FA-010', 'Façade Nord', 'youssef', 'Haute', 12, 0, []],
      [8, 'Réserve : joint silicone FA-025', 'FA-025', 'Façade Ouest', 'ahmed', 'Haute', 1, 0, []],
      [9, 'Réception provisoire lot 1', 'Lot 1', 'Global', 'sara', 'Normale', -20, 100, ['DOE remis', 'PV de réception signé']],
    ];
    const insTask = db.prepare(`INSERT INTO tasks (id, project_id, column_id, title, repere, zone, assignee_id, priority, due_date, progress, position, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insSub = db.prepare('INSERT INTO subtasks (id, task_id, title, done) VALUES (?, ?, ?, ?)');
    T.forEach(([col, title, repere, zone, who, prio, due, prog, subs], i) => {
      const tid = uid();
      insTask.run(tid, P, cols[col].id, title, repere, zone, U[who], prio, isoDate(due), prog, i, now());
      subs.forEach((s, j) => insSub.run(uid(), tid, s, j < Math.round((subs.length * prog) / 100) ? 1 : 0));
    });

    // Façade elements: 600 éléments, ~5 000 m² au total
    const PREFIXES = ['FA', 'FA', 'F', 'PF', 'MC', 'V'];
    const TYPES = { FA: 'Façade aluminium', F: 'Fenêtre', PF: 'Porte-fenêtre', MC: 'Mur-rideau', V: 'Verrière' };
    const SYSTEMS = { FA: 'Façade 50 mm', F: 'Fenêtre battante 70 mm', PF: 'Porte-fenêtre coulissante 80 mm', MC: 'Mur-rideau 65 mm', V: 'Verrière 100 mm' };
    const VITRAGES = ['Double vitrage 6/16/44.2 Low-E', 'Triple vitrage', 'Feuilleté 44.2 Low-E'];
    const RALS = ['RAL 7016', 'RAL 9007', 'RAL 7022', 'RAL 9005'];
    const ZONES = ['Façade Nord', 'Façade Sud', 'Façade Est', 'Façade Ouest'];
    const RATES = [0.7, 0.6, 0.5, 0.2, 0.25, 0.15]; // étude, appro, fabrication, contrôle, livraison, pose
    const stage = (rate, idx) => (idx < rate * N ? 'Fait' : idx < (rate + 0.05) * N ? 'En cours' : 'À faire');

    const insEl = db.prepare(`INSERT INTO facade_elements (id, project_id, repere, type, systeme, largeur_mm, hauteur_mm, surface_m2, poids_kg,
      vitrage, ral, quantite, niveau, zone, statut_etude, statut_approvisionnement, statut_fabrication, statut_controle, statut_livraison, statut_pose)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const counters = {};
    for (let i = 0; i < N; i++) {
      const prefix = PREFIXES[i % PREFIXES.length];
      counters[prefix] = (counters[prefix] ?? 0) + 1;
      const repere = `${prefix}-${String(counters[prefix]).padStart(3, '0')}`;
      const largeur = 2000 + ((i * 137) % 2000);
      const hauteur = 2400 + ((i * 89) % 900);
      const surface = Number(((largeur * hauteur) / 1e6).toFixed(2));
      insEl.run(
        uid(), P, repere, TYPES[prefix], SYSTEMS[prefix], largeur, hauteur, surface, Math.round(surface * 14),
        VITRAGES[i % VITRAGES.length], RALS[i % RALS.length], 1, `R+${1 + (i % 8)}`, ZONES[i % ZONES.length],
        ...RATES.map((r) => stage(r, i)),
      );
    }

    const insRes = db.prepare(`INSERT INTO reserves (id, project_id, numero, zone, repere, description, responsable_id, priority, date_limite, statut, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    [
      ['Façade Ouest', 'FA-025', 'Joint silicone non conforme en pied de meneau', 'ahmed', 'Haute', 3, 'Ouverte'],
      ['Façade Nord', 'FA-012', 'Rayure sur profil après pose', 'omar', 'Normale', 7, 'En cours'],
      ['Façade Sud', 'MC-001', 'Fixation de platine à reprendre', 'ahmed', 'Haute', 2, 'Corrigée'],
    ].forEach(([zone, repere, desc, who, prio, due, statut], i) =>
      insRes.run(uid(), P, i + 1, zone, repere, desc, U[who], prio, isoDate(due), statut, now()),
    );

    db.exec('COMMIT');
    console.log('Seed OK');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Premier démarrage : jeu de démonstration (SEED_DEMO=true) ou compte administrateur (ADMIN_EMAIL / ADMIN_PASSWORD)
export function seed() {
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) return;
  if (process.env.SEED_DEMO === 'true') {
    seedDemo();
    console.log('Données de démonstration créées (mot de passe : demo1234). Ne pas utiliser en production.');
    return;
  }
  const email = (process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? '';
  if (!email || password.length < 10) {
    const missing = [!email && 'ADMIN_EMAIL', password.length < 10 && 'ADMIN_PASSWORD (10 caractères minimum)'].filter(Boolean).join(', ');
    console.warn(`Aucun utilisateur. Variables absentes ou invalides au démarrage : ${missing}. Voir README (création manuelle avec npm run create-admin).`);
    return;
  }
  db.prepare('INSERT INTO users (id, name, email, password_hash, role, fonction, phone, equipe) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(uid(), process.env.ADMIN_NAME || 'Administrateur', email, hashPassword(password), 'ADMIN', 'Administrateur', null, 'Direction');
  console.log(`Administrateur créé : ${email}`);
}
