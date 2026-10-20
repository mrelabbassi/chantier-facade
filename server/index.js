import express from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, seed, now, uid, isoDate, insertProject, PROJECT_FIELDS, hashPassword, verifyPassword } from './db.js';
import { registerCrm } from './crm.js';
import { registerQuotes } from './quotes.js';
import { registerLifecycle } from './lifecycle.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UPLOADS = join(ROOT, 'data', 'uploads');
mkdirSync(UPLOADS, { recursive: true });
seed();

const app = express();
// Derrière le proxy de Render : req.ip doit être l'adresse réelle du client (anti-force brute)
app.set('trust proxy', 1);
// Les envois de fichiers (documents, photos) passent par un corps brut, pas par le parseur JSON
app.use(express.json({
  limit: '5mb',
  type: (req) => !(req.method === 'POST' && /\/(documents|photos)$/.test(req.path)),
}));

let ready = false;
// Sonde de disponibilité, sans authentification
app.get('/readyz', (_req, res) => {
  res.status(ready ? 204 : 503).end();
});

const round1 = (v) => Math.round(v * 10) / 10;
const today = () => isoDate(0);
const publicUser = ({ password_hash, ...u }) => u;

// Droits par rôle, sous forme de capacités. ADMIN a tout.
const FULL_TEAM = [
  'dashboard.read', 'chantier.read', 'finance.read', 'contacts.read', 'crm.read', 'crm.write',
  'projects.write', 'tasks.write', 'reserves.write', 'facade.write', 'documents.write', 'photos.write',
];
const CAPS = {
  DIRECTEUR: FULL_TEAM,
  CHEF_DE_PROJET: FULL_TEAM,
  CONDUCTEUR: ['dashboard.read', 'chantier.read', 'contacts.read', 'crm.read', 'projects.write', 'tasks.write', 'reserves.write', 'facade.write', 'photos.write'],
  BUREAU_ETUDE: ['dashboard.read', 'chantier.read', 'documents.write', 'facade.write', 'photos.write'],
  CHEF_EQUIPE: ['dashboard.read', 'chantier.read', 'tasks.write', 'facade.write', 'photos.write'],
  // Poseur : uniquement ses tâches (avancement, colonne, sous-tâches, commentaires) et ses photos
  POSEUR: ['tasks.own', 'photos.write'],
  CLIENT: ['dashboard.read', 'chantier.read'],
};
const can = (user, cap) => user.role === 'ADMIN' || (CAPS[user.role] ?? []).includes(cap);
// Un utilisateur sans lecture globale du chantier ne voit que ses propres tâches et photos
const fieldOnly = (user) => !can(user, 'chantier.read');
const canSeeFinance = (user) => can(user, 'finance.read');
const withoutFinance = (obj) => Object.fromEntries(Object.entries(obj).filter(([k]) => !/budget|cout|marge|montant/i.test(k)));
const forUser = (user, obj) => (canSeeFinance(user) ? obj : withoutFinance(obj));
// Avancement, compteurs et lots ne sont visibles que si l'utilisateur peut lire le chantier
const summaryFor = (user, p) => {
  const full = projectSummary(p);
  if (can(user, 'chantier.read')) return full;
  const { tasks_total, tasks_late, reserves_open, avancement, lots, ...rest } = full;
  return rest;
};


const need = (cap) => (req, res, next) => (can(req.user, cap)
  ? next()
  : res.status(403).json({ error: 'Votre rôle ne permet pas cette action.' }));

// Documents qui peuvent contenir des montants : masqués au rôle CLIENT (liste, commentaires, téléchargement)
const HIDDEN_FOR_CLIENT = ['Devis', 'Commandes'];
const hidesFrom = (user, category) => user.role === 'CLIENT' && HIDDEN_FOR_CLIENT.includes(category);

const STAGES = {
  etudes: 'statut_etude',
  approvisionnement: 'statut_approvisionnement',
  fabrication: 'statut_fabrication',
  controle: 'statut_controle',
  livraison: 'statut_livraison',
  pose: 'statut_pose',
};
const FACADE_STATUSES = ['À faire', 'En cours', 'Fait'];
const FACADE_EXTRA_FIELDS = ['zone', 'niveau', 'vitrage', 'ral'];
const RESERVE_STATUSES = ['Ouverte', 'En cours', 'Corrigée', 'Contrôlée', 'Clôturée'];
const PRIORITIES = ['Haute', 'Normale', 'Basse'];
const RESERVE_FIELDS = ['statut', 'priority', 'zone', 'repere', 'description', 'responsable_id', 'date_limite'];
const ROLES = ['ADMIN', 'DIRECTEUR', 'CHEF_DE_PROJET', 'CONDUCTEUR', 'BUREAU_ETUDE', 'CHEF_EQUIPE', 'POSEUR', 'CLIENT'];
const DOC_CATEGORIES = [
  "Plans architecte", "Plans d'exécution", 'Plans de fabrication', 'Plans de pose', 'Notes de calcul',
  'Fiches techniques', 'Fiches matériaux', 'PV', 'DOE', 'Photos', 'Courriers', 'Emails', 'Devis', 'Commandes',
];
const DOC_STATUSES = ['Brouillon', 'En validation', 'Validé', 'Archivé'];
const PHOTO_CATEGORIES = ['Avant travaux', 'Pendant travaux', 'Après travaux', 'Défaut', 'Réserve', 'Contrôle', 'Réception'];
const TASK_FIELDS = ['title', 'repere', 'zone', 'assignee_id', 'priority', 'due_date', 'progress', 'column_id', 'position'];
const FIELD_TASK_KEYS = ['progress', 'column_id'];
const rawBody = express.raw({ type: () => true, limit: '25mb' });

// Avancement par lot, pondéré par la surface des éléments de façade
function lotProgress(projectId) {
  const sel = Object.entries(STAGES)
    .map(([key, col]) => `COALESCE(100.0 * SUM(CASE WHEN ${col} = 'Fait' THEN surface_m2 ELSE 0 END) / NULLIF(SUM(surface_m2), 0), 0) AS ${key}`)
    .join(', ');
  const row = db.prepare(`SELECT ${sel} FROM facade_elements WHERE project_id = ?`).get(projectId);
  const lots = Object.keys(STAGES).map((key) => ({ key, progress: round1(row?.[key] ?? 0) }));
  const global = lots.reduce((s, l) => s + l.progress, 0) / lots.length;
  return { lots, global: round1(global) };
}

function projectSummary(p) {
  const t = db
    .prepare(`SELECT COUNT(*) AS total,
        SUM(CASE WHEN progress < 100 AND due_date < ? THEN 1 ELSE 0 END) AS late
      FROM tasks WHERE project_id = ?`)
    .get(today(), p.id);
  const reserves = db
    .prepare("SELECT COUNT(*) AS n FROM reserves WHERE project_id = ? AND statut != 'Clôturée'")
    .get(p.id).n;
  const lot = lotProgress(p.id);
  const elementStats = db
    .prepare('SELECT COUNT(*) AS n, COALESCE(SUM(surface_m2), 0) AS m2 FROM facade_elements WHERE project_id = ?')
    .get(p.id);
  return {
    ...p,
    tasks_total: t.total,
    tasks_late: t.late ?? 0,
    reserves_open: reserves,
    avancement: lot.global,
    lots: lot.lots,
    // Compteurs toujours cohérents avec les éléments réellement saisis
    nombre_elements: elementStats.n,
    surface_facade: round1(elementStats.m2),
  };
}

function patchRow(table, id, fields, body) {
  const keys = fields.filter((k) => body[k] !== undefined);
  if (!keys.length) return false;
  const values = keys.map((k) => (typeof body[k] === 'boolean' ? Number(body[k]) : (body[k] ?? null)));
  db.prepare(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...values, id);
  return true;
}

// Une tâche est modifiable si l'utilisateur a le droit d'écrire les tâches, ou si elle lui est affectée (rôle poseur)
function canTouchTask(user, taskId) {
  if (can(user, 'tasks.write')) return true;
  if (!can(user, 'tasks.own')) return false;
  const t = db.prepare('SELECT assignee_id FROM tasks WHERE id = ?').get(taskId);
  return !!t && t.assignee_id === user.id;
}

// Un poseur ne peut modifier que l'avancement et la colonne de sa propre tâche
function canPatchTask(user, taskId, body) {
  if (can(user, 'tasks.write')) return true;
  return canTouchTask(user, taskId) && Object.keys(body).every((k) => FIELD_TASK_KEYS.includes(k));
}

// Authentification : email et mot de passe, session stockée en base, jeton dans un cookie HttpOnly
const SESSION_COOKIE = 'cf_session';
const SESSION_MS = 30 * 24 * 3600 * 1000;
const MIN_PASSWORD = 10;
const secureCookie = process.env.NODE_ENV === 'production';

const readCookie = (req, name) => {
  const part = String(req.headers.cookie ?? '').split(';').map((c) => c.trim()).find((c) => c.startsWith(`${name}=`));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : null;
};

// Anti-force brute : 10 échecs par adresse et par email, fenêtre de 15 minutes
const LOGIN_MAX = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const failures = new Map();
const throttleKey = (req, email) => `${req.ip}|${email}`;
const isLocked = (key) => {
  const f = failures.get(key);
  return !!f && f.count >= LOGIN_MAX && Date.now() - f.first < LOGIN_WINDOW_MS;
};
const recordFailure = (key) => {
  const f = failures.get(key);
  if (!f || Date.now() - f.first >= LOGIN_WINDOW_MS) failures.set(key, { count: 1, first: Date.now() });
  else f.count += 1;
};

function sessionUser(token) {
  if (!token) return null;
  return db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND s.created_at > ?`)
    .get(token, new Date(Date.now() - SESSION_MS).toISOString()) ?? null;
}

app.post('/api/auth/login', (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');
  const key = throttleKey(req, email);
  if (isLocked(key)) return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans quelques minutes.' });
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!u || !verifyPassword(password, u.password_hash)) {
    recordFailure(key);
    return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });
  }
  failures.delete(key);
  const token = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)').run(token, u.id, now());
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: secureCookie, path: '/', maxAge: SESSION_MS });
  res.json(publicUser(u));
});

app.post('/api/auth/logout', (req, res) => {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax', secure: secureCookie });
  res.json({ ok: true });
});

function auth(req, res, next) {
  const user = sessionUser(readCookie(req, SESSION_COOKIE));
  if (!user) return res.status(401).json({ error: 'Connexion requise.' });
  req.user = user;
  next();
}

app.use('/api', auth);

app.get('/api/auth/me', (req, res) => res.json(publicUser(req.user)));
app.get('/api/roles', (_req, res) => res.json(ROLES));

// Utilisateurs
app.get('/api/users', (req, res) => {
  const rows = db.prepare('SELECT id, name, email, role, fonction, phone, equipe FROM users ORDER BY name').all();
  const contacts = can(req.user, 'contacts.read');
  res.json(rows.map(({ email, phone, ...u }) => (contacts ? { ...u, email, phone } : u)));
});

app.patch('/api/users/:id/role', (req, res) => {
  if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Réservé aux administrateurs' });
  if (!ROLES.includes(req.body.role)) return res.status(400).json({ error: 'Rôle invalide' });
  if (req.params.id === req.user.id && req.body.role !== 'ADMIN') {
    return res.status(400).json({ error: 'Vous ne pouvez pas retirer votre propre rôle ADMIN' });
  }
  const info = db.prepare('UPDATE users SET role = ? WHERE id = ?').run(req.body.role, req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Utilisateur introuvable' });
  res.json(publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id)));
});

// Création de comptes et réinitialisation de mot de passe (administrateur uniquement)
app.post('/api/users', (req, res) => {
  if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Réservé aux administrateurs' });
  const name = String(req.body?.name ?? '').trim();
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const role = req.body?.role ?? 'CLIENT';
  const password = String(req.body?.password ?? '');
  if (!name || !email) return res.status(400).json({ error: 'Nom et email requis' });
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Rôle invalide' });
  if (password.length < MIN_PASSWORD) return res.status(400).json({ error: `Mot de passe : ${MIN_PASSWORD} caractères minimum` });
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return res.status(409).json({ error: 'Cet email existe déjà' });
  const id = uid();
  const opt = (k) => String(req.body?.[k] ?? '').trim() || null;
  db.prepare('INSERT INTO users (id, name, email, password_hash, role, fonction, phone, equipe) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, name, email, hashPassword(password), role, opt('fonction'), opt('phone'), opt('equipe'));
  res.status(201).json(publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)));
});

app.post('/api/users/:id/password', (req, res) => {
  if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Réservé aux administrateurs' });
  const password = String(req.body?.password ?? '');
  if (password.length < MIN_PASSWORD) return res.status(400).json({ error: `Mot de passe : ${MIN_PASSWORD} caractères minimum` });
  const info = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Utilisateur introuvable' });
  // Ferme les sessions ouvertes avec l'ancien mot de passe
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Tableau de bord
app.get('/api/dashboard', need('dashboard.read'), (req, res) => {
  const projects = db.prepare('SELECT * FROM projects WHERE archived_at IS NULL').all().map(projectSummary);
  const t = today();
  const tasks = db
    .prepare(`SELECT
        SUM(CASE WHEN progress < 100 AND due_date < ? THEN 1 ELSE 0 END) AS late,
        SUM(CASE WHEN progress < 100 AND due_date = ? THEN 1 ELSE 0 END) AS today,
        SUM(CASE WHEN priority = 'Haute' AND progress < 100 THEN 1 ELSE 0 END) AS priority
      FROM tasks WHERE project_id IN (SELECT id FROM projects WHERE archived_at IS NULL)`)
    .get(t, t);
  const avg = projects.length ? projects.reduce((s, p) => s + p.avancement, 0) / projects.length : 0;
  res.json({
    chantiers_en_cours: projects.filter((p) => p.statut !== 'Terminé').length,
    chantiers_termines: projects.filter((p) => p.statut === 'Terminé').length,
    taches_en_retard: tasks.late ?? 0,
    taches_du_jour: tasks.today ?? 0,
    taches_prioritaires: tasks.priority ?? 0,
    avancement_moyen: round1(avg),
    reserves_ouvertes: projects.reduce((s, p) => s + p.reserves_open, 0),
    finance: canSeeFinance(req.user),
    chantiers: projects.map((p) => ({
      id: p.id,
      name: p.name,
      statut: p.statut,
      avancement: p.avancement,
      ...(canSeeFinance(req.user) ? { budget: p.budget } : {}),
      tasks_late: p.tasks_late,
      reserves_open: p.reserves_open,
    })),
  });
});

// Chantiers
app.get('/api/projects', (req, res) => {
  // ?scope=active (défaut) | archived | all
const scope = req.query.scope ?? 'active';
const where = scope === 'archived' ? 'WHERE archived_at IS NOT NULL' : scope === 'all' ? '' : 'WHERE archived_at IS NULL';
const rows = db.prepare(`SELECT * FROM projects ${where} ORDER BY created_at`).all();
  res.json(rows.map((p) => forUser(req.user, summaryFor(req.user, p))));
});

app.post('/api/projects', need('projects.write'), (req, res) => {
  if (!req.body.name) return res.status(400).json({ error: 'Le nom du chantier est requis' });
  res.status(201).json({ id: insertProject(req.body) });
});

app.get('/api/projects/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Chantier introuvable' });
  const columns = db.prepare('SELECT * FROM kanban_columns WHERE project_id = ? ORDER BY position').all(p.id);
  const allTasks = db.prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY position').all(p.id);
  // Un poseur ne voit que les tâches qui lui sont affectées
  const tasks = fieldOnly(req.user) ? allTasks.filter((t) => t.assignee_id === req.user.id) : allTasks;
  const subtasks = db
    .prepare('SELECT s.* FROM subtasks s JOIN tasks t ON t.id = s.task_id WHERE t.project_id = ? ORDER BY s.rowid')
    .all(p.id);
  const commentCounts = db
    .prepare('SELECT c.task_id, COUNT(*) AS n FROM comments c JOIN tasks t ON t.id = c.task_id WHERE t.project_id = ? GROUP BY c.task_id')
    .all(p.id);
  const commentMap = Object.fromEntries(commentCounts.map((c) => [c.task_id, c.n]));
  const cards = tasks.map((t) => ({
    ...t,
    subtasks: subtasks.filter((s) => s.task_id === t.id).map((s) => ({ ...s, done: !!s.done })),
    comments_count: commentMap[t.id] ?? 0,
  }));
  res.json(forUser(req.user, {
    ...summaryFor(req.user, p),
    columns: columns.map((c) => ({ ...c, tasks: cards.filter((t) => t.column_id === c.id) })),
  }));
});

app.patch('/api/projects/:id', need('projects.write'), (req, res) => {
  if (!patchRow('projects', req.params.id, PROJECT_FIELDS, req.body)) {
    return res.status(400).json({ error: 'Aucun champ à modifier' });
  }
  res.json(db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id));
});

// Tâches (cartes Kanban)
app.post('/api/projects/:id/tasks', need('tasks.write'), (req, res) => {
  const b = req.body;
  if (!b.title || !b.column_id) return res.status(400).json({ error: 'Titre et colonne requis' });
  const { maxpos } = db
    .prepare('SELECT COALESCE(MAX(position), 0) AS maxpos FROM tasks WHERE project_id = ?')
    .get(req.params.id);
  const id = uid();
  db.prepare(`INSERT INTO tasks (id, project_id, column_id, title, repere, zone, assignee_id, priority, due_date, progress, position, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, req.params.id, b.column_id, b.title, b.repere ?? null, b.zone ?? null, b.assignee_id ?? null,
    b.priority ?? 'Normale', b.due_date ?? null, Number(b.progress ?? 0), maxpos + 1, now(),
  );
  res.status(201).json(db.prepare('SELECT * FROM tasks WHERE id = ?').get(id));
});

app.patch('/api/tasks/:id', (req, res) => {
  if (!canPatchTask(req.user, req.params.id, req.body)) {
    return res.status(403).json({ error: 'Vous ne pouvez modifier que vos tâches, et seulement leur avancement et leur colonne.' });
  }
  if (!patchRow('tasks', req.params.id, TASK_FIELDS, req.body)) {
    return res.status(400).json({ error: 'Aucun champ à modifier' });
  }
  res.json(db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id));
});

app.delete('/api/tasks/:id', need('tasks.write'), (req, res) => {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Sous-tâches
app.post('/api/tasks/:id/subtasks', (req, res) => {
  if (!canTouchTask(req.user, req.params.id)) return res.status(403).json({ error: 'Tâche non affectée à votre compte' });
  const title = String(req.body.title ?? '').trim();
  if (!title) return res.status(400).json({ error: 'Titre requis' });
  const id = uid();
  db.prepare('INSERT INTO subtasks (id, task_id, title, done) VALUES (?, ?, ?, 0)').run(id, req.params.id, title);
  res.status(201).json(db.prepare('SELECT * FROM subtasks WHERE id = ?').get(id));
});

const subtaskTaskId = (id) => db.prepare('SELECT task_id FROM subtasks WHERE id = ?').get(id)?.task_id;

app.patch('/api/subtasks/:id', (req, res) => {
  const taskId = subtaskTaskId(req.params.id);
  if (!taskId) return res.status(404).json({ error: 'Sous-tâche introuvable' });
  if (!canTouchTask(req.user, taskId)) return res.status(403).json({ error: 'Tâche non affectée à votre compte' });
  const body = { ...req.body };
  if (body.done !== undefined) body.done = body.done ? 1 : 0;
  if (!patchRow('subtasks', req.params.id, ['title', 'done'], body)) {
    return res.status(400).json({ error: 'Aucun champ à modifier' });
  }
  res.json(db.prepare('SELECT * FROM subtasks WHERE id = ?').get(req.params.id));
});

app.delete('/api/subtasks/:id', (req, res) => {
  const taskId = subtaskTaskId(req.params.id);
  if (taskId && !canTouchTask(req.user, taskId)) return res.status(403).json({ error: 'Tâche non affectée à votre compte' });
  db.prepare('DELETE FROM subtasks WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Commentaires de tâches
app.get('/api/tasks/:id/comments', (req, res) => {
  if (fieldOnly(req.user) && !canTouchTask(req.user, req.params.id)) {
    return res.status(403).json({ error: 'Tâche non affectée à votre compte' });
  }
  res.json(
    db.prepare(`SELECT c.*, u.name AS author_name FROM comments c LEFT JOIN users u ON u.id = c.author_id
      WHERE c.task_id = ? ORDER BY c.created_at`).all(req.params.id),
  );
});

app.post('/api/tasks/:id/comments', (req, res) => {
  if (!canTouchTask(req.user, req.params.id)) return res.status(403).json({ error: 'Tâche non affectée à votre compte' });
  const body = String(req.body.body ?? '').trim();
  if (!body) return res.status(400).json({ error: 'Commentaire vide' });
  const id = uid();
  db.prepare('INSERT INTO comments (id, task_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, req.params.id, req.user.id, body, now());
  res.status(201).json(
    db.prepare('SELECT c.*, u.name AS author_name FROM comments c LEFT JOIN users u ON u.id = c.author_id WHERE c.id = ?').get(id),
  );
});

// Recherche globale (un poseur ne voit que ses tâches et n'a pas accès aux éléments de façade)
app.get('/api/search', (req, res) => {
  const term = String(req.query.q ?? '').trim();
  if (!term) return res.json([]);
  const q = `%${term}%`;
  const fieldOnlyUser = fieldOnly(req.user);
  const taskScope = fieldOnlyUser ? ' AND assignee_id = ?' : '';
  const taskArgs = fieldOnlyUser ? [req.user.id] : [];
  const results = [
    ...db.prepare("SELECT id, name AS title, 'chantier' AS kind, id AS project_id FROM projects WHERE name LIKE ? AND archived_at IS NULL").all(q),
    ...db.prepare(`SELECT id, title, 'tâche' AS kind, project_id FROM tasks WHERE (title LIKE ? OR repere LIKE ?)${taskScope}`)
      .all(q, q, ...taskArgs),
    ...(fieldOnlyUser ? [] : db.prepare("SELECT id, repere AS title, 'élément' AS kind, project_id FROM facade_elements WHERE repere LIKE ?").all(q)),
    ...(fieldOnlyUser ? [] : db.prepare("SELECT id, name AS title, 'personne' AS kind, NULL AS project_id FROM users WHERE name LIKE ?").all(q)),
  ];
  res.json(results.slice(0, 50));
});

// Éléments de façade
app.get('/api/projects/:id/facade-elements', need('chantier.read'), (req, res) => {
  res.json(db.prepare('SELECT * FROM facade_elements WHERE project_id = ? ORDER BY repere').all(req.params.id));
});


  app.post('/api/projects/:id/facade-elements', need('facade.write'), (req, res) => {
  const b = req.body ?? {};
  const repere = String(b.repere ?? '').trim();
  if (!repere) return res.status(400).json({ error: 'Le repère est requis (ex. FA-026)' });
  if (!db.prepare('SELECT 1 FROM projects WHERE id = ?').get(req.params.id)) {
    return res.status(404).json({ error: 'Chantier introuvable' });
  }
  if (db.prepare('SELECT 1 FROM facade_elements WHERE project_id = ? AND lower(repere) = lower(?)').get(req.params.id, repere)) {
    return res.status(409).json({ error: `Le repère ${repere} existe déjà sur ce chantier` });
  }
  const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
  const largeur = num(b.largeur_mm);
  const hauteur = num(b.hauteur_mm);
  const surface = largeur && hauteur ? (largeur * hauteur) / 1e6 : 0;
  const id = uid();
  db.prepare(`INSERT INTO facade_elements (id, project_id, repere, type, systeme, largeur_mm, hauteur_mm, surface_m2, poids_kg, vitrage, ral, quantite, niveau, zone)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, req.params.id, repere, b.type || null, b.systeme || null, largeur, hauteur, surface,
    num(b.poids_kg), b.vitrage || null, b.ral || null, Math.max(1, num(b.quantite) ?? 1),
    b.niveau || null, b.zone || null,
  );
  res.status(201).json(db.prepare('SELECT * FROM facade_elements WHERE id = ?').get(id));
});

// Éléments de façade : champs saisissables (null = vide ; champ absent de l'entrée = inchangé)
const FACADE_BLANK = {
  repere: '', type: null, systeme: null, largeur_mm: null, hauteur_mm: null, poids_kg: null,
  vitrage: null, ral: null, quantite: 1, niveau: null, zone: null,
  statut_etude: 'À faire', statut_approvisionnement: 'À faire', statut_fabrication: 'À faire',
  statut_controle: 'À faire', statut_livraison: 'À faire', statut_pose: 'À faire',
};
const FACADE_NUMERIC = ['largeur_mm', 'hauteur_mm', 'poids_kg', 'quantite'];
const FACADE_IMPORT_KEYS = ['type', 'systeme', 'largeur_mm', 'hauteur_mm', 'poids_kg', 'vitrage', 'ral', 'quantite', 'niveau', 'zone'];
const FACADE_COLS = [...Object.keys(FACADE_BLANK), 'surface_m2'];
const numOrNull = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
const facadeOf = (id) => db.prepare('SELECT * FROM facade_elements WHERE id = ?').get(id);
const repereTaken = (projectId, repere, exceptId) => !!db
  .prepare('SELECT 1 FROM facade_elements WHERE project_id = ? AND lower(repere) = lower(?) AND id != ?')
  .get(projectId, repere, exceptId ?? '');

// Fusionne des champs saisis dans un élément et recalcule la surface à partir des dimensions
function mergeFacade(base, input) {
  const next = { ...base };
  for (const k of Object.keys(FACADE_BLANK)) {
    if (input[k] === undefined) continue;
    next[k] = FACADE_NUMERIC.includes(k) ? numOrNull(input[k]) : (String(input[k] ?? '').trim() || null);
  }
  next.quantite = Math.max(1, next.quantite ?? 1);
  next.surface_m2 = next.largeur_mm && next.hauteur_mm ? (next.largeur_mm * next.hauteur_mm) / 1e6 : 0;
  return next;
}

function saveFacade(projectId, id, row) {
  if (id) {
    db.prepare(`UPDATE facade_elements SET ${FACADE_COLS.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
      .run(...FACADE_COLS.map((c) => row[c]), id);
    return id;
  }
  const newId = uid();
  db.prepare(`INSERT INTO facade_elements (id, project_id, ${FACADE_COLS.join(', ')}) VALUES (?, ?, ${FACADE_COLS.map(() => '?').join(', ')})`)
    .run(newId, projectId, ...FACADE_COLS.map((c) => row[c]));
  return newId;
}

app.patch('/api/facade-elements/:id', need('facade.write'), (req, res) => {
  const cur = facadeOf(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Élément introuvable' });
  const b = req.body ?? {};
  for (const col of Object.values(STAGES)) {
    if (b[col] !== undefined && !FACADE_STATUSES.includes(b[col])) {
      return res.status(400).json({ error: `Statut invalide : ${b[col]}` });
    }
  }
  if (b.repere !== undefined && !String(b.repere).trim()) {
    return res.status(400).json({ error: 'Le repère ne peut pas être vide' });
  }
  if (!Object.keys(b).some((k) => k in FACADE_BLANK)) return res.status(400).json({ error: 'Aucun champ à modifier' });
  const next = mergeFacade(cur, b);
  if (repereTaken(cur.project_id, next.repere, cur.id)) {
    return res.status(409).json({ error: `Le repère ${next.repere} existe déjà sur ce chantier` });
  }
  saveFacade(cur.project_id, cur.id, next);
  res.json(facadeOf(cur.id));
});

app.delete('/api/facade-elements/:id', need('facade.write'), (req, res) => {
  const info = db.prepare('DELETE FROM facade_elements WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Élément introuvable' });
  res.json({ ok: true });
});

// Import en lot : un repère existant est mis à jour (colonnes présentes seulement, statuts intacts), sinon créé
app.post('/api/projects/:id/facade-elements/import', need('facade.write'), (req, res) => {
  const pid = req.params.id;
  if (!db.prepare('SELECT 1 FROM projects WHERE id = ?').get(pid)) {
    return res.status(404).json({ error: 'Chantier introuvable' });
  }
  const rows = req.body?.rows;
  if (!Array.isArray(rows)) return res.status(400).json({ error: 'Liste de lignes attendue' });
  if (rows.length > 500) return res.status(400).json({ error: 'Maximum 500 lignes par envoi' });
  const report = { created: 0, updated: 0, errors: [] };
  db.exec('BEGIN');
  try {
    rows.forEach((r, i) => {
      const repere = String(r?.repere ?? '').trim();
      if (!repere) {
        report.errors.push({ line: i + 1, error: 'repère manquant' });
        return;
      }
      const existing = db.prepare('SELECT * FROM facade_elements WHERE project_id = ? AND lower(repere) = lower(?)').get(pid, repere);
      // Un repère existant garde sa casse d'origine (FA-025 reste FA-025 même si le fichier dit fa-025)
      const input = { repere: existing ? existing.repere : repere };
      for (const k of FACADE_IMPORT_KEYS) if (r[k] !== undefined) input[k] = r[k];
      const next = mergeFacade(existing ?? { ...FACADE_BLANK }, input);
      saveFacade(pid, existing?.id, next);
      if (existing) report.updated++;
      else report.created++;
    });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  res.json(report);
});

// Réserves
const RESERVE_SELECT = `SELECT r.*, u.name AS responsable_name FROM reserves r
  LEFT JOIN users u ON u.id = r.responsable_id`;

app.get('/api/projects/:id/reserves', need('chantier.read'), (req, res) => {
  res.json(db.prepare(`${RESERVE_SELECT} WHERE r.project_id = ? ORDER BY r.numero`).all(req.params.id));
});

app.post('/api/projects/:id/reserves', need('reserves.write'), (req, res) => {
  const b = req.body;
  const description = String(b.description ?? '').trim();
  if (!description) return res.status(400).json({ error: 'Description requise' });
  const { maxn } = db
    .prepare('SELECT COALESCE(MAX(numero), 0) AS maxn FROM reserves WHERE project_id = ?')
    .get(req.params.id);
  const id = uid();
  db.prepare(`INSERT INTO reserves (id, project_id, numero, zone, repere, description, responsable_id, priority, date_limite, statut, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Ouverte', ?)`).run(
    id, req.params.id, maxn + 1, b.zone || null, b.repere || null, description,
    b.responsable_id || null, PRIORITIES.includes(b.priority) ? b.priority : 'Normale', b.date_limite || null, now(),
  );
  res.status(201).json(db.prepare(`${RESERVE_SELECT} WHERE r.id = ?`).get(id));
});

app.patch('/api/reserves/:id', need('reserves.write'), (req, res) => {
  if (req.body.statut !== undefined && !RESERVE_STATUSES.includes(req.body.statut)) {
    return res.status(400).json({ error: `Statut invalide : ${req.body.statut}` });
  }
  if (!patchRow('reserves', req.params.id, RESERVE_FIELDS, req.body)) {
    return res.status(400).json({ error: 'Aucun champ à modifier' });
  }
  res.json(db.prepare(`${RESERVE_SELECT} WHERE r.id = ?`).get(req.params.id));
});

app.delete('/api/reserves/:id', need('reserves.write'), (req, res) => {
  db.prepare('DELETE FROM reserves WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Fichiers : enregistrés sur le disque de la VM, métadonnées en base
function storeFile(req) {
  const id = uid();
  const bytes = req.body;
  writeFileSync(join(UPLOADS, id), bytes);
  db.prepare('INSERT INTO files (id, file_name, mime, size, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    id,
    String(req.query.file_name || 'fichier'),
    req.headers['content-type'] || 'application/octet-stream',
    bytes.length,
    createHash('sha256').update(bytes).digest('hex'),
    now(),
  );
  return id;
}

app.get('/api/files/:id', (req, res) => {
  const f = db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.id);
  if (!f) return res.status(404).json({ error: 'Fichier introuvable' });
  const linked = db.prepare('SELECT category FROM documents WHERE file_id = ?').all(f.id);
  if (linked.some((d) => hidesFrom(req.user, d.category))) return res.status(404).json({ error: 'Fichier introuvable' });
  const photo = db.prepare('SELECT author_id FROM photos WHERE file_id = ?').get(f.id);
  if (photo && fieldOnly(req.user) && photo.author_id !== req.user.id) {
    return res.status(404).json({ error: 'Fichier introuvable' });
  }
  if (!photo && !linked.length && fieldOnly(req.user)) return res.status(404).json({ error: 'Fichier introuvable' });
  const inline = f.mime.startsWith('image/') || f.mime === 'application/pdf';
  if (req.query.download || !inline) res.attachment(f.file_name);
  res.type(f.mime);
  res.set('X-Content-Type-Options', 'nosniff');
  res.sendFile(join(UPLOADS, f.id), (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'Fichier introuvable' });
  });
});

// Documents : versioning par titre (même titre = nouvelle version, l'ancienne est archivée)
const DOC_SELECT = `SELECT d.*, f.file_name, f.size, f.mime, u.name AS author_name,
    (SELECT COUNT(*) FROM document_comments c WHERE c.document_id = d.id) AS comments_count
  FROM documents d
  JOIN files f ON f.id = d.file_id
  LEFT JOIN users u ON u.id = d.author_id`;

app.get('/api/projects/:id/documents', need('chantier.read'), (req, res) => {
  const docs = db.prepare(`${DOC_SELECT} WHERE d.project_id = ? ORDER BY d.title, d.version DESC`).all(req.params.id);
  res.json(docs.filter((d) => !hidesFrom(req.user, d.category)));
});

app.post('/api/projects/:id/documents', need('documents.write'), rawBody, (req, res) => {
  const title = String(req.query.title ?? '').trim();
  const category = String(req.query.category ?? '');
  if (!title) return res.status(400).json({ error: 'Titre du document requis' });
  if (!DOC_CATEGORIES.includes(category)) return res.status(400).json({ error: 'Catégorie invalide' });
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Fichier vide' });
  const pid = req.params.id;
  if (!db.prepare('SELECT 1 FROM projects WHERE id = ?').get(pid)) {
    return res.status(404).json({ error: 'Chantier introuvable' });
  }
  const { v } = db
    .prepare('SELECT COALESCE(MAX(version), 0) AS v FROM documents WHERE project_id = ? AND lower(title) = lower(?)')
    .get(pid, title);
  const fileId = storeFile(req);
  const id = uid();
  db.exec('BEGIN');
  try {
    if (v) {
      db.prepare("UPDATE documents SET status = 'Archivé' WHERE project_id = ? AND lower(title) = lower(?) AND status != 'Archivé'")
        .run(pid, title);
    }
    db.prepare(`INSERT INTO documents (id, project_id, title, category, version, status, file_id, author_id, created_at)
      VALUES (?, ?, ?, ?, ?, 'En validation', ?, ?, ?)`).run(id, pid, title, category, v + 1, fileId, req.user.id, now());
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  res.status(201).json(db.prepare(`${DOC_SELECT} WHERE d.id = ?`).get(id));
});

app.patch('/api/documents/:id', need('documents.write'), (req, res) => {
  if (req.body.status !== undefined && !DOC_STATUSES.includes(req.body.status)) {
    return res.status(400).json({ error: `Statut invalide : ${req.body.status}` });
  }
  if (!patchRow('documents', req.params.id, ['status'], req.body)) {
    return res.status(400).json({ error: 'Aucun champ à modifier' });
  }
  res.json(db.prepare(`${DOC_SELECT} WHERE d.id = ?`).get(req.params.id));
});

app.delete('/api/documents/:id', need('documents.write'), (req, res) => {
  db.prepare('DELETE FROM documents WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/documents/:id/comments', need('chantier.read'), (req, res) => {
  const doc = db.prepare('SELECT category FROM documents WHERE id = ?').get(req.params.id);
  if (!doc || hidesFrom(req.user, doc.category)) return res.status(404).json({ error: 'Document introuvable' });
  res.json(
    db.prepare(`SELECT c.*, u.name AS author_name FROM document_comments c LEFT JOIN users u ON u.id = c.author_id
      WHERE c.document_id = ? ORDER BY c.created_at`).all(req.params.id),
  );
});

app.post('/api/documents/:id/comments', need('documents.write'), (req, res) => {
  const body = String(req.body.body ?? '').trim();
  if (!body) return res.status(400).json({ error: 'Commentaire vide' });
  const id = uid();
  db.prepare('INSERT INTO document_comments (id, document_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, req.params.id, req.user.id, body, now());
  res.status(201).json(
    db.prepare('SELECT c.*, u.name AS author_name FROM document_comments c LEFT JOIN users u ON u.id = c.author_id WHERE c.id = ?').get(id),
  );
});

// Photos de chantier : métadonnées (zone, niveau, repère, catégorie, commentaire) passées dans l'URL
const PHOTO_SELECT = `SELECT p.*, f.mime, f.file_name, u.name AS author_name
  FROM photos p
  JOIN files f ON f.id = p.file_id
  LEFT JOIN users u ON u.id = p.author_id`;

app.get('/api/projects/:id/photos', (req, res) => {
  // Un poseur ne voit que les photos qu'il a lui-même prises
  const rows = fieldOnly(req.user)
    ? db.prepare(`${PHOTO_SELECT} WHERE p.project_id = ? AND p.author_id = ? ORDER BY p.created_at DESC`).all(req.params.id, req.user.id)
    : db.prepare(`${PHOTO_SELECT} WHERE p.project_id = ? ORDER BY p.created_at DESC`).all(req.params.id);
  res.json(rows);
});

app.post('/api/projects/:id/photos', need('photos.write'), rawBody, (req, res) => {
  const mime = String(req.headers['content-type'] ?? '');
  if (!mime.startsWith('image/')) return res.status(400).json({ error: 'Une image est attendue' });
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Fichier vide' });
  const category = String(req.query.category ?? 'Pendant travaux');
  if (!PHOTO_CATEGORIES.includes(category)) return res.status(400).json({ error: 'Catégorie invalide' });
  const clean = (k) => String(req.query[k] ?? '').trim() || null;
  const fileId = storeFile(req);
  const id = uid();
  db.prepare(`INSERT INTO photos (id, project_id, file_id, category, zone, niveau, repere, comment, author_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, req.params.id, fileId, category, clean('zone'), clean('niveau'), clean('repere'), clean('comment'), req.user.id, now(),
  );
  res.status(201).json(db.prepare(`${PHOTO_SELECT} WHERE p.id = ?`).get(id));
});

app.delete('/api/photos/:id', need('photos.write'), (req, res) => {
  const ph = db.prepare('SELECT author_id FROM photos WHERE id = ?').get(req.params.id);
  if (ph && fieldOnly(req.user) && ph.author_id !== req.user.id) {
    return res.status(403).json({ error: 'Vous ne pouvez supprimer que vos propres photos.' });
  }
  db.prepare('DELETE FROM photos WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// API inconnue
// CRM : doit être monté avant le 404 générique de /api
registerCrm(app, { need, can, db, uid, now, isoDate });
// Devis rattachés aux opportunités (doit suivre registerCrm : tables référencées)
registerQuotes(app, { need, can, db, uid, now, isoDate });
// Archivage et suppression des chantiers
registerLifecycle(app, { need, db, now, uploadsDir: UPLOADS });

app.use('/api', (_req, res) => res.status(404).json({ error: 'Route introuvable' }));



// Interface web (build Vite) + repli SPA
app.use(express.static(join(ROOT, 'dist')));
app.use((req, res, next) => {
  if (req.method === 'GET') return res.sendFile(join(ROOT, 'dist', 'index.html'));
  next();
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status ?? 500).json({ error: err.message });
});

const PORT = Number(process.env.PORT ?? 3000);
ready = true;
app.listen(PORT, '0.0.0.0', () => console.log(`API et interface prêtes sur http://localhost:${PORT}`));