// Archivage et suppression des chantiers.
// Archiver retire le chantier des listes actives (tableau de bord et recherche compris) sans rien effacer.
// Supprimer est définitif : il faut d'abord archiver, et seuls l'administrateur et le directeur peuvent le faire.
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const DELETE_ROLES = ['ADMIN', 'DIRECTEUR'];

export function registerLifecycle(app, { need, db, now, uploadsDir }) {
  // Migration : colonne d'archivage, ajoutée une seule fois
  const cols = db.prepare('PRAGMA table_info(projects)').all().map((c) => c.name);
  if (!cols.includes('archived_at')) db.exec('ALTER TABLE projects ADD COLUMN archived_at TEXT');

  const findProject = (id) => db.prepare('SELECT id, archived_at FROM projects WHERE id = ?').get(id);

  const setArchived = (archive) => (req, res) => {
    const p = findProject(req.params.id);
    if (!p) return res.status(404).json({ error: 'Chantier introuvable' });
    db.prepare('UPDATE projects SET archived_at = ? WHERE id = ?').run(archive ? now() : null, p.id);
    res.json(db.prepare('SELECT * FROM projects WHERE id = ?').get(p.id));
  };
  app.post('/api/projects/:id/archive', need('projects.write'), setArchived(true));
  app.post('/api/projects/:id/restore', need('projects.write'), setArchived(false));

  app.delete('/api/projects/:id', (req, res) => {
    if (!DELETE_ROLES.includes(req.user.role)) {
      return res.status(403).json({ error: "Seuls l'administrateur et le directeur peuvent supprimer un chantier." });
    }
    const p = findProject(req.params.id);
    if (!p) return res.status(404).json({ error: 'Chantier introuvable' });
    if (!p.archived_at) return res.status(409).json({ error: 'Archivez le chantier avant de le supprimer.' });

    // Documents et photos pointent vers la table files, qui n'est pas effacée en cascade :
    // on la nettoie nous-mêmes, ainsi que les fichiers sur disque.
    const fileIds = db.prepare(`SELECT file_id FROM documents WHERE project_id = ?
      UNION SELECT file_id FROM photos WHERE project_id = ?`).all(p.id, p.id).map((r) => r.file_id);

    const removed = [];
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM projects WHERE id = ?').run(p.id);
      const stillUsed = db.prepare('SELECT 1 FROM documents WHERE file_id = ? UNION ALL SELECT 1 FROM photos WHERE file_id = ? LIMIT 1');
      const delFile = db.prepare('DELETE FROM files WHERE id = ?');
      for (const fid of new Set(fileIds)) {
        if (!stillUsed.get(fid, fid)) {
          delFile.run(fid);
          removed.push(fid);
        }
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    for (const fid of removed) {
      const path = join(uploadsDir, fid);
      if (existsSync(path)) unlinkSync(path);
    }
    res.json({ ok: true, files_removed: removed.length });
  });
}