import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const base = 'http://localhost:3000';
const db = new DatabaseSync(fileURLToPath(new URL('../data/chantier.db', import.meta.url)));
let failures = 0;
const ok = (cond, msg) => {
  console.log(cond ? 'OK   ' : 'FAIL ', msg);
  if (!cond) failures++;
};

import { randomBytes } from 'node:crypto';
import { hashPassword, uid, now } from '../server/db.js';

// Comptes de test : créés directement en base, avec une session ouverte (jeton dans le cookie)
const tokens = new Map();
async function makeUser(sub, role) {
  const id = uid();
  const email = `${sub}@example.test`;
  db.prepare('INSERT INTO users (id, name, email, password_hash, role, fonction, phone, equipe) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, `Test ${sub}`, email, hashPassword('smoke-test-1'), role, 'Test', null, null);
  const token = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)').run(token, id, now());
  tokens.set(sub, token);
  return db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(id);
}

import XLSX from 'xlsx';
import { parseFacadeTable, facadeToAoa, FACADE_COLUMNS, buildFacadeExport } from '../src/lib/facadeSheet.js';

const call = (path, { sub, method = 'GET', json, body, type, headers = {} } = {}) =>
  fetch(base + path, {
    method,
    headers: {
      ...(sub ? { Cookie: `cf_session=${tokens.get(sub)}` } : {}),
      ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(type ? { 'Content-Type': type } : {}),
      ...headers,
    },
    body: json !== undefined ? JSON.stringify(json) : body,
  });

const stamp = Date.now();
const adminSub = `smoke-admin-${stamp}`;
const clientSub = `smoke-client-${stamp}`;
const poseurSub = `smoke-poseur-${stamp}`;

try {
  ok((await fetch(`${base}/readyz`)).status === 204, 'readyz 204');
  ok((await call('/api/projects')).status === 401, 'sans connexion : 401');

  const admin = await makeUser(adminSub, 'ADMIN');
  const client = await makeUser(clientSub, 'CLIENT');
  ok(client.role === 'CLIENT', 'utilisateur CLIENT connecté (lecture seule)');
  const json = { 'Content-Type': 'application/json' };
  const badLogin = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: json, body: JSON.stringify({ email: client.email, password: 'mauvais-mot-de-passe' }) });
  ok(badLogin.status === 401, 'connexion : mauvais mot de passe refusé (401)');
  const goodLogin = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: json, body: JSON.stringify({ email: client.email, password: 'smoke-test-1' }) });
  ok(goodLogin.status === 200 && (goodLogin.headers.get('set-cookie') ?? '').includes('cf_session='), 'connexion : cookie de session posé');
  ok((await fetch(`${base}/api/auth/logout`, { method: 'POST' })).status === 200, 'déconnexion : 200');

  const [project] = await (await call('/api/projects', { sub: adminSub })).json();
  const pid = project.id;
  ok(!!pid, 'chantier lisible par l\'administrateur');

  const denied = await call(`/api/projects/${pid}/reserves`, { sub: clientSub, method: 'POST', json: { description: 'SMOKE' } });
  ok(denied.status === 403, 'CLIENT ne peut pas écrire (403)');

  const d1 = await (await call(`/api/projects/${pid}/documents?title=SMOKE&category=PV&file_name=test.txt`, {
    sub: adminSub, method: 'POST', type: 'text/plain', body: 'hello',
  })).json();
  ok(d1.version === 1, 'upload document : version 1');
  const d2 = await (await call(`/api/projects/${pid}/documents?title=SMOKE&category=PV&file_name=test.txt`, {
    sub: adminSub, method: 'POST', type: 'text/plain', body: 'world',
  })).json();
  ok(d2.version === 2, 'même titre : version 2');
  const docs = await (await call(`/api/projects/${pid}/documents`, { sub: adminSub })).json();
  ok(docs.find((d) => d.id === d1.id)?.status === 'Archivé', 'version précédente archivée');
  const bytes = await (await call(`/api/files/${d2.file_id}`, { sub: adminSub })).text();
  ok(bytes === 'world', 'téléchargement du fichier stocké');

  const cm = await call(`/api/documents/${d2.id}/comments`, { sub: clientSub, method: 'POST', json: { body: 'SMOKE' } });
  ok(cm.status === 403, 'CLIENT ne peut pas commenter un document (lecture seule)');
  const cmAdmin = await call(`/api/documents/${d2.id}/comments`, { sub: adminSub, method: 'POST', json: { body: 'SMOKE' } });
  ok(cmAdmin.status === 201, 'ADMIN peut commenter un document');

  const photo = await call(`/api/projects/${pid}/photos?category=${encodeURIComponent('Défaut')}&repere=FA-025&comment=SMOKE&file_name=smoke.png`, {
    sub: adminSub, method: 'POST', type: 'image/png', body: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  });
  ok(photo.status === 201, 'photo enregistrée');
  const photos = await (await call(`/api/projects/${pid}/photos`, { sub: adminSub })).json();
  ok(photos.some((p) => p.repere === 'FA-025' && p.category === 'Défaut'), 'photo listée avec repère et catégorie');

  const notImage = await call(`/api/projects/${pid}/photos`, { sub: adminSub, method: 'POST', type: 'text/plain', body: 'x' });
  ok(notImage.status === 400, 'un fichier non image est refusé pour les photos');

  const cProjects = await (await call('/api/projects', { sub: clientSub })).json();
  ok(cProjects.length > 0 && !('budget' in cProjects[0]), 'CLIENT ne voit pas le budget d\'un chantier');
  const aProjects = await (await call('/api/projects', { sub: adminSub })).json();
  ok('budget' in aProjects[0], 'ADMIN voit le budget');
  const cDetail = await (await call(`/api/projects/${pid}`, { sub: clientSub })).json();
  ok(!('budget' in cDetail) && Array.isArray(cDetail.lots), 'CLIENT voit l\'avancement par lot sans le budget');
  const cUsers = await (await call('/api/users', { sub: clientSub })).json();
  ok(cUsers.length > 0 && cUsers.every((u) => !('email' in u)), 'CLIENT ne voit pas les coordonnées des utilisateurs');
  const cRole = await call(`/api/users/${admin.id}/role`, { sub: clientSub, method: 'PATCH', json: { role: 'POSEUR' } });
  ok(cRole.status === 403, 'CLIENT ne peut pas changer de rôle');
  const selfDemote = await call(`/api/users/${admin.id}/role`, { sub: adminSub, method: 'PATCH', json: { role: 'CLIENT' } });
  ok(selfDemote.status === 400, 'un administrateur ne peut pas retirer son propre rôle');

  const devis = await (await call(`/api/projects/${pid}/documents?title=SMOKE-DEVIS&category=Devis&file_name=devis.txt`, {
    sub: adminSub, method: 'POST', type: 'text/plain', body: 'montant',
  })).json();
  const cDocs = await (await call(`/api/projects/${pid}/documents`, { sub: clientSub })).json();
  ok(!cDocs.some((d) => d.category === 'Devis' || d.category === 'Commandes'), 'CLIENT ne voit pas les documents Devis ou Commandes');
  ok(cDocs.some((d) => d.id === d2.id), 'CLIENT voit toujours les documents autorisés');
  ok((await call(`/api/files/${devis.file_id}`, { sub: clientSub })).status === 404, 'CLIENT ne peut pas télécharger un fichier Devis (404)');
  ok((await call(`/api/files/${devis.file_id}`, { sub: adminSub })).status === 200, 'ADMIN télécharge le fichier Devis');
  ok((await call(`/api/documents/${devis.id}/comments`, { sub: clientSub })).status === 404, 'CLIENT ne voit pas les commentaires d\'un document Devis');
  const roles = await (await call('/api/roles', { sub: adminSub })).json();
  
const poseur = await makeUser(poseurSub, 'POSEUR');
  const detailAdmin = await (await call(`/api/projects/${pid}`, { sub: adminSub })).json();
  const colId = detailAdmin.columns[0].id;
  const ownTask = await (await call(`/api/projects/${pid}/tasks`, {
    sub: adminSub, method: 'POST', json: { title: 'SMOKE-POSEUR', column_id: colId, assignee_id: poseur.id },
  })).json();
  const otherTask = db.prepare("SELECT id FROM tasks WHERE (assignee_id IS NULL OR assignee_id != ?) AND title != 'SMOKE-POSEUR' LIMIT 1").get(poseur.id);

  const pDetail = await (await call(`/api/projects/${pid}`, { sub: poseurSub })).json();
  const pTasks = pDetail.columns.flatMap((c) => c.tasks);
  ok(pTasks.length > 0 && pTasks.every((t) => t.assignee_id === poseur.id), 'POSEUR ne voit que ses tâches');
ok(!('avancement' in pDetail) && !('reserves_open' in pDetail) && !pDetail.lots, 'POSEUR ne voit ni avancement ni compteurs de réserves');
  ok((await call(`/api/tasks/${ownTask.id}`, { sub: poseurSub, method: 'PATCH', json: { progress: 50 } })).status === 200, 'POSEUR met à jour l\'avancement de sa tâche');
  ok((await call(`/api/tasks/${ownTask.id}`, { sub: poseurSub, method: 'PATCH', json: { title: 'PIRATE' } })).status === 403, 'POSEUR ne peut pas renommer une tâche');
  ok((await call(`/api/tasks/${otherTask.id}`, { sub: poseurSub, method: 'PATCH', json: { progress: 10 } })).status === 403, 'POSEUR ne peut pas modifier la tâche d\'un autre');
  ok((await call(`/api/projects/${pid}/tasks`, { sub: poseurSub, method: 'POST', json: { title: 'SMOKE-X', column_id: colId } })).status === 403, 'POSEUR ne peut pas créer de tâche');
  ok((await call('/api/dashboard', { sub: poseurSub })).status === 403, 'POSEUR n\'accède pas au tableau de bord');
  ok((await call(`/api/projects/${pid}/facade-elements`, { sub: poseurSub })).status === 403, 'POSEUR ne voit pas les éléments de façade');
  ok((await call(`/api/projects/${pid}/reserves`, { sub: poseurSub })).status === 403, 'POSEUR ne voit pas les réserves');
  const pPhoto = await call(`/api/projects/${pid}/photos?category=${encodeURIComponent('Pendant travaux')}&comment=SMOKE&file_name=p.png`, {
    sub: poseurSub, method: 'POST', type: 'image/png', body: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  });
  ok(pPhoto.status === 201, 'POSEUR peut ajouter une photo');
  const pPhotos = await (await call(`/api/projects/${pid}/photos`, { sub: poseurSub })).json();
  ok(pPhotos.length > 0 && pPhotos.every((p) => p.author_id === poseur.id), 'POSEUR ne voit que ses propres photos');

  const nBefore = (await (await call(`/api/projects/${pid}`, { sub: adminSub })).json()).nombre_elements;
  const faRes = await call(`/api/projects/${pid}/facade-elements`, {
    sub: adminSub, method: 'POST', json: { repere: 'SMOKE-FA-1', type: 'Fenêtre', largeur_mm: 1000, hauteur_mm: 2000, niveau: 'R+1', zone: 'SMOKE' },
  });
  const faNew = await faRes.json();
  ok(faRes.status === 201 && faNew.surface_m2 === 2, 'ADMIN ajoute un élément de façade (surface calculée)');
  const nAfter = (await (await call(`/api/projects/${pid}`, { sub: adminSub })).json()).nombre_elements;
  ok(nAfter === nBefore + 1, 'le compteur d\'éléments du chantier se met à jour');
  ok((await call(`/api/projects/${pid}/facade-elements`, { sub: adminSub, method: 'POST', json: { repere: 'smoke-fa-1' } })).status === 409, 'repère en double refusé, casse ignorée (409)');
  ok((await call(`/api/projects/${pid}/facade-elements`, { sub: adminSub, method: 'POST', json: {} })).status === 400, 'repère requis (400)');
  ok((await call(`/api/projects/${pid}/facade-elements`, { sub: clientSub, method: 'POST', json: { repere: 'SMOKE-FA-2' } })).status === 403, 'CLIENT ne peut pas ajouter un élément (403)');
  ok((await call(`/api/projects/${pid}/facade-elements`, { sub: poseurSub, method: 'POST', json: { repere: 'SMOKE-FA-3' } })).status === 403, 'POSEUR ne peut pas ajouter un élément (403)');

  const faId = faNew.id;
  const upd = await (await call(`/api/facade-elements/${faId}`, { sub: adminSub, method: 'PATCH', json: { largeur_mm: '1500', hauteur_mm: '2000', systeme: 'SMOKE-SYS' } })).json();
  ok(upd.surface_m2 === 3 && upd.systeme === 'SMOKE-SYS', 'ADMIN modifie un élément, surface recalculée');
  ok((await call(`/api/facade-elements/${faId}`, { sub: clientSub, method: 'PATCH', json: { systeme: 'X' } })).status === 403, 'CLIENT ne peut pas modifier un élément (403)');
  ok((await call(`/api/facade-elements/${faId}`, { sub: adminSub, method: 'PATCH', json: { repere: '' } })).status === 400, 'repère vide refusé à la modification (400)');
  const imp = await (await call(`/api/projects/${pid}/facade-elements/import`, { sub: adminSub, method: 'POST', json: { rows: [
    { repere: 'SMOKE-FA-IMP-1', type: 'Porte', largeur_mm: 900, hauteur_mm: 2100 },
    { repere: 'smoke-fa-1', niveau: 'R+2' },
    { type: 'sans repère' },
  ] } })).json();
  ok(imp.created === 1 && imp.updated === 1 && imp.errors.length === 1, 'import : 1 créé, 1 mis à jour, 1 erreur');
  const updated = db.prepare("SELECT niveau, systeme FROM facade_elements WHERE repere = 'SMOKE-FA-1'").get();
  ok(updated.niveau === 'R+2' && updated.systeme === 'SMOKE-SYS', 'import met à jour sans effacer les colonnes absentes');
  ok((await call(`/api/facade-elements/${faId}`, { sub: adminSub, method: 'DELETE' })).status === 200, 'ADMIN supprime un élément');
  ok((await call(`/api/facade-elements/${faId}`, { sub: adminSub, method: 'DELETE' })).status === 404, 'supprimer un élément inexistant : 404');

// --- import et export de feuilles (XLSX / XLS / CSV) ---
{
  const aoa = [
    ['Repère', 'Type', 'Largeur (mm)', 'Hauteur (mm)', 'Quantité', 'Surface (m²)', 'Étude'],
    ['SMOKE-XL-1', 'Porte', 900, 2100, 1, 1.89, 'Fait'],
    ['', 'sans repère', 1, 1, 1, '', ''],
    ['SMOKE-XL-2', 'Fenêtre', '1 200', '2000,0', 2, '', ''],
    ['SMOKE-XL-3', 'Fenêtre', 'abc', '', 1, '', ''],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Feuille1');
  const back = XLSX.read(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' });
  const table = XLSX.utils.sheet_to_json(back.Sheets[back.SheetNames[0]], { header: 1, defval: '', raw: true });
  const parsed = parseFacadeTable(table);
  ok(parsed.rows.length === 2 && parsed.ignored === 1, 'import XLSX : lignes sans repère ignorées, en-têtes français reconnus');
  ok(parsed.rows[0].largeur_mm === 900 && parsed.rows[1].largeur_mm === 1200 && parsed.rows[1].hauteur_mm === 2000, 'import XLSX : nombres lus, espaces et virgules gérés');
  ok(parsed.errors.length === 1 && parsed.errors[0].line === 5, 'import XLSX : valeur numérique invalide signalée avec son numéro de ligne');
  ok(!('statut_etude' in parsed.rows[0]), 'import XLSX : les statuts ne sont jamais importés');

  const exp = [{ repere: 'SMOKE-XL-EXP', type: 'Mur-rideau', largeur_mm: 1500, hauteur_mm: 3000, surface_m2: 4.5, quantite: 2, niveau: 'R+3', zone: 'Nord', statut_etude: 'Fait' }];
  const wb2 = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb2, XLSX.utils.aoa_to_sheet(facadeToAoa(exp)), 'Feuille1');
  const back2 = XLSX.read(XLSX.write(wb2, { type: 'buffer', bookType: 'xls' }), { type: 'buffer' });
  const t2 = XLSX.utils.sheet_to_json(back2.Sheets[back2.SheetNames[0]], { header: 1, defval: '', raw: true });
  const r2 = parseFacadeTable(t2).rows[0];
  ok(t2[0].length === FACADE_COLUMNS.length, 'export : toutes les colonnes présentes');
  ok(r2?.repere === 'SMOKE-XL-EXP' && r2.largeur_mm === 1500 && r2.zone === 'Nord' && r2.quantite === 2, 'export XLS puis import : aller-retour sans perte');

  const exXls = await buildFacadeExport(exp, 'xls', 'test');
  ok(exXls.blob.size > 1000 && exXls.name === 'test.xls', 'export XLS : fichier binaire construit, nom correct');
  const exXlsx = await buildFacadeExport(exp, 'xlsx', 'test');
  ok(exXlsx.blob.size > 1000 && exXlsx.name === 'test.xlsx', 'export XLSX : fichier construit, nom correct');
  const exCsv = await buildFacadeExport(exp, 'csv', 'test');
  
  let badFormat = false;
  try { await buildFacadeExport(exp, 'pdf', 'test'); } catch { badFormat = true; }
  ok(badFormat, 'export : format inconnu refusé');

// --- CRM ---
{
  const a = await (await call('/api/crm/accounts', { sub: adminSub, method: 'POST', json: { name: 'SMOKE-CRM Promoteur', kind: 'Promoteur', city: 'Rabat' } })).json();
  ok(a.id && a.name === 'SMOKE-CRM Promoteur', 'CRM : ADMIN crée un compte');
  ok((await call('/api/crm/accounts', { sub: adminSub, method: 'POST', json: { name: '   ' } })).status === 400, 'CRM : nom de compte vide refusé (400)');
  const c = await (await call(`/api/crm/accounts/${a.id}/contacts`, { sub: adminSub, method: 'POST', json: { first_name: 'Ali', last_name: 'SMOKE', email: 'ali@example.test' } })).json();
  ok(c.id && c.last_name === 'SMOKE', 'CRM : contact ajouté au compte');
  const o = await (await call('/api/crm/opportunities', { sub: adminSub, method: 'POST', json: { account_id: a.id, contact_id: c.id, name: 'SMOKE-CRM Façade Tour', amount_dh: '2 450 000', stage: 'Proposition', close_date: '2026-12-31' } })).json();
  ok(o.id && o.amount_dh === 2450000 && o.probability === 50 && o.stage === 'Proposition', 'CRM : opportunité créée, montant lu, probabilité par défaut');
  ok((await call('/api/crm/opportunities', { sub: adminSub, method: 'POST', json: { account_id: a.id, name: 'x', stage: 'Inconnu' } })).status === 400, 'CRM : étape invalide refusée (400)');
  const other = await (await call('/api/crm/accounts', { sub: adminSub, method: 'POST', json: { name: 'SMOKE-CRM Autre' } })).json();
  ok((await call('/api/crm/opportunities', { sub: adminSub, method: 'POST', json: { account_id: other.id, contact_id: c.id, name: 'x' } })).status === 400, 'CRM : contact d un autre compte refusé (400)');
  const won = await (await call(`/api/crm/opportunities/${o.id}`, { sub: adminSub, method: 'PATCH', json: { stage: 'Gagné' } })).json();
  ok(won.stage === 'Gagné' && won.probability === 100 && won.closed_at, 'CRM : passage à Gagné fixe la probabilité et la date de clôture');
  const act = await (await call('/api/crm/activities', { sub: adminSub, method: 'POST', json: { opportunity_id: o.id, type: 'Visite de chantier', subject: 'SMOKE-CRM visite', due_date: '2020-01-01' } })).json();
  ok(act.id && act.account_id === a.id, 'CRM : activité liée à une opportunité, compte déduit');
  const sum = await (await call('/api/crm/summary', { sub: adminSub })).json();
  ok(sum.won >= 1 && sum.overdue_activities >= 1 && sum.pipeline_dh !== undefined, 'CRM : synthèse (gagnés, relances en retard, montants pour ADMIN)');
  ok((await call('/api/crm/accounts', { sub: clientSub })).status === 403, 'CRM : CLIENT ne voit pas le CRM (403)');

  // CONDUCTEUR : lecture sans montants, pas d'écriture
  const condSub = 'smoke-crm-conducteur';
  await makeUser(condSub, 'CONDUCTEUR');
  const condOpps = await (await call('/api/crm/opportunities', { sub: condSub })).json();
  const mine = condOpps.find((x) => x.id === o.id);
  ok(mine && mine.amount_dh === undefined && mine.name === 'SMOKE-CRM Façade Tour', 'CRM : CONDUCTEUR lit les opportunités sans montant');
  ok((await call('/api/crm/accounts', { sub: condSub, method: 'POST', json: { name: 'SMOKE-CRM x' } })).status === 403, 'CRM : CONDUCTEUR ne peut pas créer de compte (403)');
  ok((await call(`/api/crm/opportunities/${o.id}`, { sub: adminSub, method: 'DELETE' })).status === 200, 'CRM : suppression d une opportunité');
  db.prepare("DELETE FROM crm_accounts WHERE name LIKE 'SMOKE-CRM%'").run();

  // --- Archivage et suppression de chantier ---
  const arch = await (await call('/api/projects', { sub: adminSub, method: 'POST', json: { name: 'SMOKE-ARCH Chantier test' } })).json();
  ok(arch.id, 'chantier : création d un chantier de test');
  ok((await call(`/api/projects/${arch.id}`, { sub: adminSub, method: 'DELETE' })).status === 409, 'chantier : suppression refusée tant que le chantier n est pas archivé (409)');
  ok((await call(`/api/projects/${arch.id}/archive`, { sub: clientSub, method: 'POST' })).status === 403, 'chantier : CLIENT ne peut pas archiver (403)');
  const archived = await (await call(`/api/projects/${arch.id}/archive`, { sub: adminSub, method: 'POST' })).json();
  ok(archived.archived_at, 'chantier : archivage horodaté');
  const active = await (await call('/api/projects?scope=active', { sub: adminSub })).json();
  ok(!active.some((p) => p.id === arch.id), 'chantier : absent de la liste en cours');
  const onlyArchived = await (await call('/api/projects?scope=archived', { sub: adminSub })).json();
  ok(onlyArchived.some((p) => p.id === arch.id), 'chantier : présent dans la liste des archivés');
  ok((await call(`/api/projects/${arch.id}/restore`, { sub: adminSub, method: 'POST' })).status === 200, 'chantier : restauration');
  await call(`/api/projects/${arch.id}/archive`, { sub: adminSub, method: 'POST' });
  const condArch = 'smoke-arch-conducteur';
  await makeUser(condArch, 'CONDUCTEUR');
  ok((await call(`/api/projects/${arch.id}`, { sub: condArch, method: 'DELETE' })).status === 403, 'chantier : CONDUCTEUR ne peut pas supprimer (403)');
  const del = await call(`/api/projects/${arch.id}`, { sub: adminSub, method: 'DELETE' });
  ok(del.status === 200, 'chantier : ADMIN supprime un chantier archivé');
  ok(!db.prepare('SELECT 1 FROM projects WHERE id = ?').get(arch.id), 'chantier : supprimé de la base');
  db.prepare("DELETE FROM projects WHERE name LIKE 'SMOKE-ARCH%'").run();

// --- Devis ---
{
  const dAcc = await (await call('/api/crm/accounts', { sub: adminSub, method: 'POST', json: { name: 'SMOKE-DEV Client' } })).json();
  const dOpp = await (await call('/api/crm/opportunities', { sub: adminSub, method: 'POST', json: { account_id: dAcc.id, name: 'SMOKE-DEV Affaire', stage: 'Proposition' } })).json();
  const created = await call('/api/crm/quotes', { sub: adminSub, method: 'POST', json: {
    opportunity_id: dOpp.id,
    valid_until: '2026-12-31',
    lines: [
      { designation: 'Façade SMOKE-DEV', quantity: 100, unit: 'm²', unit_price: '1 200', tva_rate: 20 },
      { designation: 'Pose SMOKE-DEV', quantity: 2, unit: 'forfait', unit_price: 500, tva_rate: 10 },
    ],
  } });
  const q = await created.json();
  ok(created.status === 201 && /^DEV-\d{4}-\d{4}$/.test(q.number) && q.status === 'Brouillon', 'devis : création en brouillon, numéro DEV-AAAA-NNNN');
  ok(q.ht === 121000 && q.tva === 24100 && q.ttc === 145100, 'devis : totaux HT, TVA et TTC calculés côté serveur');
  ok((await call('/api/crm/quotes', { sub: adminSub, method: 'POST', json: { opportunity_id: dOpp.id, lines: [{ designation: 'x', quantity: 1, unit_price: 1, tva_rate: 15 }] } })).status === 400, 'devis : taux de TVA hors liste refusé (400)');
  ok((await call(`/api/crm/quotes/${q.id}`, { sub: adminSub, method: 'PATCH', json: { status: 'Accepté' } })).status === 400, 'devis : brouillon ne passe pas directement à Accepté (400)');
  ok((await call(`/api/crm/quotes/${q.id}`, { sub: adminSub, method: 'PATCH', json: { status: 'Envoyé' } })).status === 200, 'devis : brouillon envoyé');
  const acc = await (await call(`/api/crm/quotes/${q.id}`, { sub: adminSub, method: 'PATCH', json: { status: 'Accepté' } })).json();
  ok(acc.status === 'Accepté' && acc.accepted_at, 'devis : accepté, date d acceptation horodatée');
  ok((await call(`/api/crm/quotes/${q.id}`, { sub: adminSub, method: 'PATCH', json: { lines: [{ designation: 'x', quantity: 1, unit_price: 1, tva_rate: 20 }] } })).status === 400, 'devis : lignes figées hors brouillon (400)');
  ok((await call(`/api/crm/quotes/${q.id}`, { sub: adminSub, method: 'DELETE' })).status === 409, 'devis : accepté ne se supprime pas (409)');

  const condDev = 'smoke-dev-conducteur';
  await makeUser(condDev, 'CONDUCTEUR');
  const seen = (await (await call(`/api/crm/quotes?opportunity_id=${dOpp.id}`, { sub: condDev })).json())[0];
  ok(seen && seen.ttc === undefined && seen.lines[0].unit_price === undefined && seen.lines[0].designation.startsWith('Façade'), 'devis : CONDUCTEUR lit le devis sans montants');
  ok((await call('/api/crm/quotes', { sub: clientSub })).status === 403, 'devis : CLIENT ne voit pas les devis (403)');

  await call(`/api/crm/opportunities/${dOpp.id}`, { sub: adminSub, method: 'DELETE' });
  await call(`/api/crm/accounts/${dAcc.id}`, { sub: adminSub, method: 'DELETE' });
  ok(!db.prepare('SELECT 1 FROM crm_quotes WHERE id = ?').get(q.id), 'devis : supprimés avec l opportunité (cascade)');
}

  
}
}
} catch (err) {
  failures++;
  console.log('FAIL  exception :', err.message);
} finally {
  db.prepare("DELETE FROM document_comments WHERE body = 'SMOKE'").run();
  db.prepare("DELETE FROM photos WHERE comment = 'SMOKE'").run();
  db.prepare("DELETE FROM documents WHERE title = 'SMOKE'").run();
  db.prepare("DELETE FROM documents WHERE title = 'SMOKE-DEVIS'").run();
  db.prepare("DELETE FROM tasks WHERE title = 'SMOKE-POSEUR'").run();
  db.prepare("DELETE FROM facade_elements WHERE repere LIKE 'SMOKE-FA-%'").run();
  for (const sub of [adminSub, clientSub, poseurSub, 'smoke-crm-conducteur', 'smoke-arch-conducteur', 'smoke-dev-conducteur']) {
    db.prepare('DELETE FROM users WHERE email = ?').run(`${sub}@example.test`);
  }
}

console.log(failures ? `\n${failures} test(s) en échec` : '\nTous les tests passent');
process.exitCode = failures ? 1 : 0;