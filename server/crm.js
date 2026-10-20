// CRM : comptes, contacts, opportunités (pipeline de vente) et activités.
// Données partagées par l'organisation. Les montants suivent la capacité finance.read
// (même règle que les budgets des chantiers) : un CONDUCTEUR voit les opportunités sans montant.

export const STAGES = ['Prospect', 'Qualification', 'Proposition', 'Négociation', 'Gagné', 'Perdu'];
const OPEN_STAGES = STAGES.slice(0, 4);
const CLOSED_STAGES = ['Gagné', 'Perdu'];
export const ACTIVITY_TYPES = ['Appel', 'E-mail', 'Rendez-vous', 'Visite de chantier', 'Note'];
const DEFAULT_PROBA = { Prospect: 10, Qualification: 25, Proposition: 50, 'Négociation': 75, 'Gagné': 100, 'Perdu': 0 };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const text = (v, max = 200) => {
  const s = v == null ? '' : String(v).trim();
  return s ? s.slice(0, max) : null;
};
// vide → null ; texte numérique (espaces, virgule) → nombre ; NaN = invalide
const amount = (v) => {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : NaN;
};
// vide → null ; date AAAA-MM-JJ → texte ; sinon NaN
const dateOf = (v) => {
  if (v == null || v === '') return null;
  return DATE_RE.test(String(v)) ? String(v) : NaN;
};
const money2 = (n) => Math.round(n * 100) / 100;

export function registerCrm(app, { need, can, db, uid, now, isoDate }) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS crm_accounts (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT, city TEXT, phone TEXT, email TEXT, notes TEXT,
    owner_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS crm_contacts (
    id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES crm_accounts(id) ON DELETE CASCADE,
    first_name TEXT, last_name TEXT NOT NULL, title TEXT, email TEXT, phone TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS crm_opportunities (
    id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES crm_accounts(id) ON DELETE CASCADE,
    contact_id TEXT REFERENCES crm_contacts(id) ON DELETE SET NULL,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    name TEXT NOT NULL, stage TEXT NOT NULL DEFAULT 'Prospect', amount_dh REAL,
    probability INTEGER NOT NULL DEFAULT 10, close_date TEXT, next_step TEXT, owner_id TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, closed_at TEXT
  );
  CREATE TABLE IF NOT EXISTS crm_activities (
    id TEXT PRIMARY KEY,
    opportunity_id TEXT REFERENCES crm_opportunities(id) ON DELETE CASCADE,
    account_id TEXT REFERENCES crm_accounts(id) ON DELETE CASCADE,
    type TEXT NOT NULL, subject TEXT NOT NULL, due_date TEXT, done INTEGER NOT NULL DEFAULT 0,
    author_id TEXT, created_at TEXT NOT NULL
  );`);

  const canFinance = (user) => can(user, 'finance.read');

  // Les montants n'existent pas dans la réponse pour un utilisateur sans finance.read
  const withAmounts = (user, row) => {
    if (!canFinance(user)) return { ...row, amount_dh: undefined, weighted_dh: undefined };
    const weighted = row.amount_dh == null ? null : money2((row.amount_dh * row.probability) / 100);
    return { ...row, weighted_dh: weighted };
  };

  const listOpps = (user, where = '1 = 1', params = []) => db.prepare(`
    SELECT o.*, a.name AS account_name,
      NULLIF(TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')), '') AS contact_name
    FROM crm_opportunities o
    JOIN crm_accounts a ON a.id = o.account_id
    LEFT JOIN crm_contacts c ON c.id = o.contact_id
    WHERE ${where}
    ORDER BY o.updated_at DESC`).all(...params).map((r) => withAmounts(user, r));

  const listActivities = (where = '1 = 1', params = []) => db.prepare(`
    SELECT x.*, o.name AS opportunity_name, a.name AS account_name
    FROM crm_activities x
    LEFT JOIN crm_opportunities o ON o.id = x.opportunity_id
    LEFT JOIN crm_accounts a ON a.id = x.account_id
    WHERE ${where}
    ORDER BY x.done ASC, COALESCE(x.due_date, '9999-12-31') ASC, x.created_at DESC
    LIMIT 500`).all(...params).map((r) => ({ ...r, done: !!r.done }));

  const checkRefs = (accountId, contactId, projectId) => {
    if (!accountId || !db.prepare('SELECT 1 FROM crm_accounts WHERE id = ?').get(accountId)) {
      return 'Compte obligatoire ou introuvable';
    }
    if (contactId && !db.prepare('SELECT 1 FROM crm_contacts WHERE id = ? AND account_id = ?').get(contactId, accountId)) {
      return "Ce contact n'appartient pas à ce compte";
    }
    if (projectId && !db.prepare('SELECT 1 FROM projects WHERE id = ?').get(projectId)) {
      return 'Chantier introuvable';
    }
    return null;
  };

  // Valide et fusionne les champs saisis dans une opportunité (cur = null à la création)
  const buildOpp = (b, cur) => {
    const v = (k) => (b[k] !== undefined ? b[k] : cur?.[k]);
    const name = text(v('name'));
    if (!name) return { error: "Le nom de l'opportunité est obligatoire" };
    const stage = v('stage') ?? 'Prospect';
    if (!STAGES.includes(stage)) return { error: `Étape invalide : ${stage}` };
    const amt = amount(v('amount_dh'));
    if (Number.isNaN(amt)) return { error: 'Montant invalide' };
    const dt = dateOf(v('close_date'));
    if (Number.isNaN(dt)) return { error: 'Date de clôture invalide (AAAA-MM-JJ)' };
    const stageChanged = !cur || b.stage !== undefined;
    let proba = b.probability !== undefined && b.probability !== ''
      ? Number(b.probability)
      : (stageChanged ? DEFAULT_PROBA[stage] : cur.probability);
    if (!Number.isFinite(proba) || proba < 0 || proba > 100) return { error: 'Probabilité entre 0 et 100' };
    proba = Math.round(proba);
    const closedAt = CLOSED_STAGES.includes(stage)
      ? (cur && cur.stage === stage && cur.closed_at ? cur.closed_at : now())
      : null;
    return {
      row: {
        name,
        stage,
        amount_dh: amt,
        probability: proba,
        close_date: dt,
        next_step: text(v('next_step'), 300),
        contact_id: v('contact_id') || null,
        project_id: v('project_id') || null,
        closed_at: closedAt,
      },
    };
  };

  // ---------- Comptes ----------

  app.get('/api/crm/accounts', need('crm.read'), (_req, res) => {
    res.json(db.prepare(`
      SELECT a.*,
        (SELECT COUNT(*) FROM crm_contacts c WHERE c.account_id = a.id) AS contacts,
        (SELECT COUNT(*) FROM crm_opportunities o WHERE o.account_id = a.id AND o.stage NOT IN ('Gagné', 'Perdu')) AS open_opportunities
      FROM crm_accounts a ORDER BY a.name COLLATE NOCASE`).all());
  });

  app.get('/api/crm/accounts/:id', need('crm.read'), (req, res) => {
    const account = db.prepare('SELECT * FROM crm_accounts WHERE id = ?').get(req.params.id);
    if (!account) return res.status(404).json({ error: 'Compte introuvable' });
    const contacts = db.prepare('SELECT * FROM crm_contacts WHERE account_id = ? ORDER BY last_name COLLATE NOCASE').all(account.id);
    const opportunities = listOpps(req.user, 'o.account_id = ?', [account.id]);
    res.json({ ...account, contacts, opportunities });
  });

  app.post('/api/crm/accounts', need('crm.write'), (req, res) => {
    const b = req.body ?? {};
    const name = text(b.name);
    if (!name) return res.status(400).json({ error: 'Le nom du compte est obligatoire' });
    const id = uid();
    const t = now();
    db.prepare(`INSERT INTO crm_accounts (id, name, kind, city, phone, email, notes, owner_id, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(id, name, text(b.kind, 80), text(b.city, 80), text(b.phone, 40), text(b.email, 120), text(b.notes, 2000), req.user.id ?? null, t, t);
    res.status(201).json(db.prepare('SELECT * FROM crm_accounts WHERE id = ?').get(id));
  });

  app.patch('/api/crm/accounts/:id', need('crm.write'), (req, res) => {
    const cur = db.prepare('SELECT * FROM crm_accounts WHERE id = ?').get(req.params.id);
    if (!cur) return res.status(404).json({ error: 'Compte introuvable' });
    const b = req.body ?? {};
    const pick = (k, max) => (b[k] === undefined ? cur[k] : text(b[k], max));
    const name = b.name === undefined ? cur.name : text(b.name, 200);
    if (!name) return res.status(400).json({ error: 'Le nom du compte est obligatoire' });
    db.prepare('UPDATE crm_accounts SET name = ?, kind = ?, city = ?, phone = ?, email = ?, notes = ?, updated_at = ? WHERE id = ?')
      .run(name, pick('kind', 80), pick('city', 80), pick('phone', 40), pick('email', 120), pick('notes', 2000), now(), cur.id);
    res.json(db.prepare('SELECT * FROM crm_accounts WHERE id = ?').get(cur.id));
  });

  app.delete('/api/crm/accounts/:id', need('crm.write'), (req, res) => {
    const id = req.params.id;
    if (!db.prepare('SELECT 1 FROM crm_accounts WHERE id = ?').get(id)) return res.status(404).json({ error: 'Compte introuvable' });
    db.prepare('DELETE FROM crm_activities WHERE account_id = ? OR opportunity_id IN (SELECT id FROM crm_opportunities WHERE account_id = ?)').run(id, id);
    db.prepare('DELETE FROM crm_opportunities WHERE account_id = ?').run(id);
    db.prepare('DELETE FROM crm_contacts WHERE account_id = ?').run(id);
    db.prepare('DELETE FROM crm_accounts WHERE id = ?').run(id);
    res.json({ ok: true });
  });

  // ---------- Contacts ----------

  app.post('/api/crm/accounts/:id/contacts', need('crm.write'), (req, res) => {
    if (!db.prepare('SELECT 1 FROM crm_accounts WHERE id = ?').get(req.params.id)) {
      return res.status(404).json({ error: 'Compte introuvable' });
    }
    const b = req.body ?? {};
    const last = text(b.last_name, 80);
    if (!last) return res.status(400).json({ error: 'Le nom du contact est obligatoire' });
    const id = uid();
    db.prepare(`INSERT INTO crm_contacts (id, account_id, first_name, last_name, title, email, phone, created_at)
      VALUES (?,?,?,?,?,?,?,?)`)
      .run(id, req.params.id, text(b.first_name, 80), last, text(b.title, 120), text(b.email, 120), text(b.phone, 40), now());
    res.status(201).json(db.prepare('SELECT * FROM crm_contacts WHERE id = ?').get(id));
  });

  app.delete('/api/crm/contacts/:id', need('crm.write'), (req, res) => {
    const info = db.prepare('DELETE FROM crm_contacts WHERE id = ?').run(req.params.id);
    if (!info.changes) return res.status(404).json({ error: 'Contact introuvable' });
    db.prepare('UPDATE crm_opportunities SET contact_id = NULL WHERE contact_id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  // ---------- Opportunités ----------

  app.get('/api/crm/opportunities', need('crm.read'), (req, res) => {
    res.json(listOpps(req.user));
  });

  app.post('/api/crm/opportunities', need('crm.write'), (req, res) => {
    const b = req.body ?? {};
    const built = buildOpp(b, null);
    if (built.error) return res.status(400).json({ error: built.error });
    const refErr = checkRefs(b.account_id, built.row.contact_id, built.row.project_id);
    if (refErr) return res.status(400).json({ error: refErr });
    const r = built.row;
    const id = uid();
    const t = now();
    db.prepare(`INSERT INTO crm_opportunities (id, account_id, contact_id, project_id, name, stage, amount_dh, probability,
      close_date, next_step, owner_id, created_at, updated_at, closed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, b.account_id, r.contact_id, r.project_id, r.name, r.stage, r.amount_dh, r.probability,
        r.close_date, r.next_step, req.user.id ?? null, t, t, r.closed_at);
    res.status(201).json(listOpps(req.user, 'o.id = ?', [id])[0]);
  });

  app.patch('/api/crm/opportunities/:id', need('crm.write'), (req, res) => {
    const cur = db.prepare('SELECT * FROM crm_opportunities WHERE id = ?').get(req.params.id);
    if (!cur) return res.status(404).json({ error: 'Opportunité introuvable' });
    const b = req.body ?? {};
    const built = buildOpp(b, cur);
    if (built.error) return res.status(400).json({ error: built.error });
    const accountId = b.account_id ?? cur.account_id;
    const refErr = checkRefs(accountId, built.row.contact_id, built.row.project_id);
    if (refErr) return res.status(400).json({ error: refErr });
    const r = built.row;
    db.prepare(`UPDATE crm_opportunities SET account_id = ?, contact_id = ?, project_id = ?, name = ?, stage = ?,
      amount_dh = ?, probability = ?, close_date = ?, next_step = ?, closed_at = ?, updated_at = ? WHERE id = ?`)
      .run(accountId, r.contact_id, r.project_id, r.name, r.stage, r.amount_dh, r.probability,
        r.close_date, r.next_step, r.closed_at, now(), cur.id);
    res.json(listOpps(req.user, 'o.id = ?', [cur.id])[0]);
  });

  app.delete('/api/crm/opportunities/:id', need('crm.write'), (req, res) => {
    const id = req.params.id;
    if (!db.prepare('SELECT 1 FROM crm_opportunities WHERE id = ?').get(id)) {
      return res.status(404).json({ error: 'Opportunité introuvable' });
    }
    db.prepare('DELETE FROM crm_activities WHERE opportunity_id = ?').run(id);
    db.prepare('DELETE FROM crm_opportunities WHERE id = ?').run(id);
    res.json({ ok: true });
  });

  // ---------- Activités ----------

  app.get('/api/crm/activities', need('crm.read'), (_req, res) => {
    res.json(listActivities());
  });

  app.post('/api/crm/activities', need('crm.write'), (req, res) => {
    const b = req.body ?? {};
    const subject = text(b.subject);
    if (!subject) return res.status(400).json({ error: "Le sujet de l'activité est obligatoire" });
    const type = b.type ?? 'Note';
    if (!ACTIVITY_TYPES.includes(type)) return res.status(400).json({ error: `Type invalide : ${type}` });
    const due = dateOf(b.due_date);
    if (Number.isNaN(due)) return res.status(400).json({ error: "Date d'échéance invalide (AAAA-MM-JJ)" });
    let accountId = b.account_id || null;
    if (b.opportunity_id) {
      const opp = db.prepare('SELECT account_id FROM crm_opportunities WHERE id = ?').get(b.opportunity_id);
      if (!opp) return res.status(400).json({ error: 'Opportunité introuvable' });
      accountId = opp.account_id;
    } else if (!accountId) {
      return res.status(400).json({ error: "Liez l'activité à une opportunité ou à un compte" });
    } else if (!db.prepare('SELECT 1 FROM crm_accounts WHERE id = ?').get(accountId)) {
      return res.status(400).json({ error: 'Compte introuvable' });
    }
    const id = uid();
    db.prepare(`INSERT INTO crm_activities (id, opportunity_id, account_id, type, subject, due_date, done, author_id, created_at)
      VALUES (?,?,?,?,?,?,0,?,?)`)
      .run(id, b.opportunity_id || null, accountId, type, subject, due, req.user.id ?? null, now());
    res.status(201).json(listActivities('x.id = ?', [id])[0]);
  });

  app.patch('/api/crm/activities/:id', need('crm.write'), (req, res) => {
    const cur = db.prepare('SELECT * FROM crm_activities WHERE id = ?').get(req.params.id);
    if (!cur) return res.status(404).json({ error: 'Activité introuvable' });
    const b = req.body ?? {};
    const subject = b.subject === undefined ? cur.subject : text(b.subject);
    if (!subject) return res.status(400).json({ error: "Le sujet de l'activité est obligatoire" });
    const due = b.due_date === undefined ? cur.due_date : dateOf(b.due_date);
    if (Number.isNaN(due)) return res.status(400).json({ error: "Date d'échéance invalide (AAAA-MM-JJ)" });
    const done = b.done === undefined ? cur.done : (b.done ? 1 : 0);
    db.prepare('UPDATE crm_activities SET subject = ?, due_date = ?, done = ? WHERE id = ?').run(subject, due, done, cur.id);
    res.json(listActivities('x.id = ?', [cur.id])[0]);
  });

  app.delete('/api/crm/activities/:id', need('crm.write'), (req, res) => {
    const info = db.prepare('DELETE FROM crm_activities WHERE id = ?').run(req.params.id);
    if (!info.changes) return res.status(404).json({ error: 'Activité introuvable' });
    res.json({ ok: true });
  });

  // ---------- Synthèse ----------

  app.get('/api/crm/summary', need('crm.read'), (req, res) => {
    const fin = canFinance(req.user);
    const perStage = new Map(
      db.prepare('SELECT stage, COUNT(*) AS n, COALESCE(SUM(amount_dh), 0) AS amt FROM crm_opportunities GROUP BY stage')
        .all().map((r) => [r.stage, r]),
    );
    const stages = STAGES.map((stage) => {
      const r = perStage.get(stage);
      return { stage, count: r?.n ?? 0, ...(fin ? { amount_dh: money2(r?.amt ?? 0) } : {}) };
    });
    const count = (s) => stages.find((x) => x.stage === s).count;
    const won = count('Gagné');
    const lost = count('Perdu');
    const open = OPEN_STAGES.reduce((n, s) => n + count(s), 0);
    const today = isoDate(0);
    const one = (sql, ...params) => db.prepare(sql).get(...params).n;
    const body = {
      stages,
      open,
      won,
      lost,
      win_rate: won + lost ? Math.round((won * 100) / (won + lost)) : null,
      overdue_activities: one("SELECT COUNT(*) AS n FROM crm_activities WHERE done = 0 AND due_date < ?", today),
      due_today: one('SELECT COUNT(*) AS n FROM crm_activities WHERE done = 0 AND due_date = ?', today),
    };
    if (fin) {
      const placeholders = OPEN_STAGES.map(() => '?').join(', ');
      const tot = db.prepare(`SELECT COALESCE(SUM(amount_dh), 0) AS p,
          COALESCE(SUM(amount_dh * probability / 100.0), 0) AS w
        FROM crm_opportunities WHERE stage IN (${placeholders})`).get(...OPEN_STAGES);
      body.pipeline_dh = money2(tot.p);
      body.weighted_dh = money2(tot.w);
    }
    res.json(body);
  });
}