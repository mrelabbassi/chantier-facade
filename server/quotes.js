// Devis rattachés aux opportunités du CRM : lignes, TVA, numérotation et statuts.
// Un devis ne change pas l'étape de l'opportunité : c'est l'utilisateur qui décide.
// Lecture : crm.read (les montants exigent finance.read). Écriture : crm.write.

export const QUOTE_STATUSES = ['Brouillon', 'Envoyé', 'Accepté', 'Refusé', 'Annulé'];
const TVA_RATES = [0, 7, 10, 20];
// Transitions autorisées depuis chaque statut
const NEXT = {
  'Brouillon': ['Envoyé', 'Annulé'],
  'Envoyé': ['Accepté', 'Refusé', 'Annulé'],
  'Accepté': [],
  'Refusé': [],
  'Annulé': [],
};
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const round2 = (n) => Math.round(n * 100) / 100;
const num = (v) => {
  if (v == null || v === '') return NaN;
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};
const txt = (v, max) => {
  const s = v == null ? '' : String(v).trim();
  return s ? s.slice(0, max) : null;
};
// vide → null ; date AAAA-MM-JJ → texte ; sinon NaN
const dateOf = (v) => {
  if (v == null || v === '') return null;
  return DATE_RE.test(String(v)) ? String(v) : NaN;
};

// Valide les lignes ; renvoie { lines } ou { error }
export function checkLines(input) {
  if (!Array.isArray(input) || input.length === 0) return { error: 'Ajoutez au moins une ligne au devis' };
  if (input.length > 200) return { error: 'Un devis ne peut pas dépasser 200 lignes' };
  const lines = [];
  for (const [i, raw] of input.entries()) {
    const n = i + 1;
    const designation = txt(raw?.designation, 300);
    if (!designation) return { error: `Ligne ${n} : désignation obligatoire` };
    const quantity = num(raw.quantity);
    if (!(quantity > 0)) return { error: `Ligne ${n} : quantité invalide` };
    const unit_price = num(raw.unit_price);
    if (!(unit_price >= 0)) return { error: `Ligne ${n} : prix unitaire invalide` };
    const tva_rate = Number(raw.tva_rate ?? 20);
    if (!TVA_RATES.includes(tva_rate)) return { error: `Ligne ${n} : taux de TVA non autorisé` };
    lines.push({ designation, unit: txt(raw.unit, 20) ?? 'u', quantity, unit_price, tva_rate });
  }
  return { lines };
}

// Calcule les montants de chaque ligne puis les totaux du devis
export function totalsOf(lines) {
  let ht = 0;
  let tva = 0;
  const rows = lines.map((l) => {
    const line_ht = round2(l.quantity * l.unit_price);
    const line_tva = round2((line_ht * l.tva_rate) / 100);
    ht += line_ht;
    tva += line_tva;
    return { ...l, line_ht, line_tva, line_ttc: round2(line_ht + line_tva) };
  });
  return { lines: rows, ht: round2(ht), tva: round2(tva), ttc: round2(ht + tva) };
}

export function registerQuotes(app, { need, can, db, uid, now, isoDate }) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS crm_quotes (
    id TEXT PRIMARY KEY,
    number TEXT NOT NULL UNIQUE,
    opportunity_id TEXT NOT NULL REFERENCES crm_opportunities(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'Brouillon',
    valid_until TEXT, notes TEXT, author_id TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, accepted_at TEXT
  );
  CREATE TABLE IF NOT EXISTS crm_quote_lines (
    id TEXT PRIMARY KEY,
    quote_id TEXT NOT NULL REFERENCES crm_quotes(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    designation TEXT NOT NULL, unit TEXT, quantity REAL NOT NULL, unit_price REAL NOT NULL, tva_rate INTEGER NOT NULL
  );`);

  const canFinance = (user) => can(user, 'finance.read');

  // Sans finance.read, les montants n'existent pas dans la réponse
  const present = (user, q) => {
    const stored = db.prepare('SELECT * FROM crm_quote_lines WHERE quote_id = ? ORDER BY position').all(q.id);
    if (!canFinance(user)) {
      return { ...q, lines: stored.map(({ designation, unit, quantity }) => ({ designation, unit, quantity })) };
    }
    const t = totalsOf(stored);
    return { ...q, lines: t.lines, ht: t.ht, tva: t.tva, ttc: t.ttc };
  };

  const select = (where = '1 = 1', params = []) => db.prepare(`
    SELECT q.*, o.name AS opportunity_name, a.name AS account_name
    FROM crm_quotes q
    JOIN crm_opportunities o ON o.id = q.opportunity_id
    JOIN crm_accounts a ON a.id = o.account_id
    WHERE ${where}
    ORDER BY q.created_at DESC`).all(...params);

  const nextNumber = (year) => {
    const { m } = db.prepare(
      "SELECT COALESCE(MAX(CAST(SUBSTR(number, 10) AS INTEGER)), 0) AS m FROM crm_quotes WHERE number LIKE ?",
    ).get(`DEV-${year}-%`);
    return `DEV-${year}-${String(m + 1).padStart(4, '0')}`;
  };

  const writeLines = (quoteId, lines) => {
    db.prepare('DELETE FROM crm_quote_lines WHERE quote_id = ?').run(quoteId);
    const ins = db.prepare(`INSERT INTO crm_quote_lines (id, quote_id, position, designation, unit, quantity, unit_price, tva_rate)
      VALUES (?,?,?,?,?,?,?,?)`);
    lines.forEach((l, i) => ins.run(uid(), quoteId, i + 1, l.designation, l.unit, l.quantity, l.unit_price, l.tva_rate));
  };

  const inTx = (fn) => {
    db.exec('BEGIN');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };

  app.get('/api/crm/quotes', need('crm.read'), (req, res) => {
    const opp = req.query.opportunity_id;
    const rows = opp ? select('q.opportunity_id = ?', [opp]) : select();
    res.json(rows.map((q) => present(req.user, q)));
  });

  app.post('/api/crm/quotes', need('crm.write'), (req, res) => {
    const b = req.body ?? {};
    if (!b.opportunity_id || !db.prepare('SELECT 1 FROM crm_opportunities WHERE id = ?').get(b.opportunity_id)) {
      return res.status(400).json({ error: 'Opportunité introuvable' });
    }
    const checked = checkLines(b.lines);
    if (checked.error) return res.status(400).json({ error: checked.error });
    const valid = dateOf(b.valid_until);
    if (Number.isNaN(valid)) return res.status(400).json({ error: 'Date de validité invalide (AAAA-MM-JJ)' });

    const id = uid();
    const t = now();
    inTx(() => {
      const number = nextNumber(isoDate(0).slice(0, 4));
      db.prepare(`INSERT INTO crm_quotes (id, number, opportunity_id, status, valid_until, notes, author_id, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(id, number, b.opportunity_id, 'Brouillon', valid, txt(b.notes, 2000), req.user.id ?? null, t, t);
      writeLines(id, checked.lines);
    });
    res.status(201).json(present(req.user, select('q.id = ?', [id])[0]));
  });

  app.patch('/api/crm/quotes/:id', need('crm.write'), (req, res) => {
    const cur = db.prepare('SELECT * FROM crm_quotes WHERE id = ?').get(req.params.id);
    if (!cur) return res.status(404).json({ error: 'Devis introuvable' });
    const b = req.body ?? {};

    let status = cur.status;
    if (b.status !== undefined && b.status !== cur.status) {
      if (!QUOTE_STATUSES.includes(b.status)) return res.status(400).json({ error: `Statut invalide : ${b.status}` });
      if (!(NEXT[cur.status] ?? []).includes(b.status)) {
        return res.status(400).json({ error: `Passage de « ${cur.status} » à « ${b.status} » impossible` });
      }
      status = b.status;
    }

    let lines = null;
    if (b.lines !== undefined) {
      if (cur.status !== 'Brouillon') return res.status(400).json({ error: 'Les lignes ne se modifient que sur un brouillon' });
      const checked = checkLines(b.lines);
      if (checked.error) return res.status(400).json({ error: checked.error });
      lines = checked.lines;
    }

    const valid = b.valid_until === undefined ? cur.valid_until : dateOf(b.valid_until);
    if (Number.isNaN(valid)) return res.status(400).json({ error: 'Date de validité invalide (AAAA-MM-JJ)' });
    const t = now();
    const accepted = status === 'Accepté' && cur.status !== 'Accepté' ? t : cur.accepted_at;
    const notes = b.notes === undefined ? cur.notes : txt(b.notes, 2000);

    inTx(() => {
      db.prepare('UPDATE crm_quotes SET status = ?, valid_until = ?, notes = ?, accepted_at = ?, updated_at = ? WHERE id = ?')
        .run(status, valid, notes, accepted, t, cur.id);
      if (lines) writeLines(cur.id, lines);
    });
    res.json(present(req.user, select('q.id = ?', [cur.id])[0]));
  });

  app.delete('/api/crm/quotes/:id', need('crm.write'), (req, res) => {
    const cur = db.prepare('SELECT status FROM crm_quotes WHERE id = ?').get(req.params.id);
    if (!cur) return res.status(404).json({ error: 'Devis introuvable' });
    if (cur.status !== 'Brouillon') {
      return res.status(409).json({ error: 'Seul un brouillon peut être supprimé. Annulez le devis sinon.' });
    }
    db.prepare('DELETE FROM crm_quotes WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });
}