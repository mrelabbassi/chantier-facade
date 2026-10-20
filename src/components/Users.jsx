import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { inputCls, btnCls, btnGhost } from './ui.jsx';

const LABELS = {
  ADMIN: 'Administrateur',
  DIRECTEUR: 'Directeur',
  CHEF_DE_PROJET: 'Chef de projet',
  CONDUCTEUR: 'Conducteur de travaux',
  BUREAU_ETUDE: "Bureau d'étude",
  CHEF_EQUIPE: "Chef d'équipe",
  POSEUR: 'Poseur',
  CLIENT: 'Client (lecture seule)',
};

const EMPTY = { name: '', email: '', role: 'CLIENT', password: '', fonction: '', equipe: '', phone: '' };

export default function Users() {
  const [users, setUsers] = useState(null);
  const [roles, setRoles] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const load = () =>
    Promise.all([api('/users'), api('/roles')])
      .then(([u, r]) => {
        setUsers(u);
        setRoles(r);
      })
      .catch((e) => setError(e.message));

  useEffect(() => { load(); }, []);

  const flash = (msg, isError = false) => {
    if (isError) { setError(msg); setInfo(''); }
    else { setInfo(msg); setError(''); }
  };

  const change = async (u, role) => {
    try {
      await api(`/users/${u.id}/role`, { method: 'PATCH', body: { role } });
      flash(`Rôle de ${u.name} mis à jour.`);
    } catch (e) {
      flash(e.message, true);
    } finally {
      load();
    }
  };

  const create = async (e) => {
    e.preventDefault();
    try {
      const u = await api('/users', { method: 'POST', body: form });
      flash(`Compte créé pour ${u.name}. Communiquez-lui son mot de passe en toute sécurité.`);
      setForm(EMPTY);
      load();
    } catch (err) {
      flash(err.message, true);
    }
  };

  const resetPassword = async (u) => {
    const password = window.prompt(`Nouveau mot de passe pour ${u.name} (10 caractères minimum) :`);
    if (!password) return;
    try {
      await api(`/users/${u.id}/password`, { method: 'POST', body: { password } });
      flash(`Mot de passe de ${u.name} réinitialisé. Ses sessions ouvertes ont été fermées.`);
    } catch (err) {
      flash(err.message, true);
    }
  };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Utilisateurs et rôles</h1>
        <p className="text-sm text-slate-500">
          Seul un administrateur peut créer un compte, modifier un rôle ou réinitialiser un mot de passe.
        </p>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {info && <p className="text-sm text-emerald-700">{info}</p>}

      <form onSubmit={create} className="grid gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:grid-cols-2 lg:grid-cols-4">
        <h2 className="text-sm font-semibold text-slate-700 sm:col-span-2 lg:col-span-4">Nouveau compte</h2>
        <input required placeholder="Nom complet" value={form.name} onChange={set('name')} className={inputCls} />
        <input required type="email" placeholder="Email" value={form.email} onChange={set('email')} className={inputCls} />
        <input required type="password" minLength={10} placeholder="Mot de passe (10 caractères min.)" value={form.password} onChange={set('password')} className={inputCls} />
        <select value={form.role} onChange={set('role')} className={inputCls}>
          {roles.map((r) => <option key={r} value={r}>{LABELS[r] ?? r}</option>)}
        </select>
        <input placeholder="Fonction" value={form.fonction} onChange={set('fonction')} className={inputCls} />
        <input placeholder="Équipe" value={form.equipe} onChange={set('equipe')} className={inputCls} />
        <input placeholder="Téléphone" value={form.phone} onChange={set('phone')} className={inputCls} />
        <button type="submit" className={btnCls}>Créer le compte</button>
      </form>

      {!users ? (
        <p className="text-slate-500">Chargement…</p>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Nom</th>
                <th className="px-2 py-2">Fonction</th>
                <th className="px-2 py-2">Équipe</th>
                <th className="px-2 py-2">Contact</th>
                <th className="px-2 py-2">Rôle</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="px-3 py-2 font-medium">{u.name}</td>
                  <td className="px-2 py-2">{u.fonction ?? '—'}</td>
                  <td className="px-2 py-2">{u.equipe ?? '—'}</td>
                  <td className="px-2 py-2 text-slate-500">{u.email ?? '—'}</td>
                  <td className="px-2 py-2">
                    <select
                      value={u.role}
                      onChange={(e) => change(u, e.target.value)}
                      className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm"
                    >
                      {roles.map((r) => <option key={r} value={r}>{LABELS[r] ?? r}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-2">
                    <button type="button" onClick={() => resetPassword(u)} className={btnGhost}>Mot de passe</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
