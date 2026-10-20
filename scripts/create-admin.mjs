// Création manuelle d'un administrateur, par exemple depuis le Shell de Render :
//   npm run create-admin -- votre@email.ma "votre-mot-de-passe-10-caracteres"
import { db, hashPassword, uid } from '../server/db.js';

const [email = '', password = '', ...nameParts] = process.argv.slice(2);
const cleanEmail = email.trim().toLowerCase();

if (!cleanEmail.includes('@') || password.length < 10) {
  console.error('Usage : npm run create-admin -- <email> <mot de passe (10 caractères minimum)> [nom]');
  process.exit(1);
}
if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(cleanEmail)) {
  // Compte existant : on lui donne le rôle ADMIN et on met à jour le mot de passe
  db.prepare('UPDATE users SET role = ?, password_hash = ? WHERE email = ?').run('ADMIN', hashPassword(password), cleanEmail);
  console.log(`Compte existant promu administrateur, mot de passe mis à jour : ${cleanEmail}`);
} else {
  db.prepare('INSERT INTO users (id, name, email, password_hash, role, fonction, phone, equipe) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(uid(), nameParts.join(' ') || 'Administrateur', cleanEmail, hashPassword(password), 'ADMIN', 'Administrateur', null, 'Direction');
  console.log(`Administrateur créé : ${cleanEmail}`);
}
