import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { inputCls } from './ui.jsx';
import CrmQuotes from './CrmQuotes.jsx';

const STAGES = ['Prospect', 'Qualification', 'Proposition', 'Négociation', 'Gagné', 'Perdu'];
const STAGE_CLS = {
  Prospect: 'bg-slate-100 text-slate-700',
  Qualification: 'bg-sky-100 text-sky-800',
  Proposition: 'bg-indigo-100 text-indigo-800',
  'Négociation': 'bg-amber-100 text-amber-800',
  'Gagné': 'bg-emerald-100 text-emerald-800',
  'Perdu': 'bg-rose-100 text-rose-800',
};
const ACTIVITY_TYPES = ['Appel', 'E-mail', 'Rendez-vous', 'Visite de chantier', 'Note'];
const KINDS = ['Promoteur', "Maître d'ouvrage", 'Entreprise générale', 'Architecte', "Bureau d'études", 'Client final', 'Fournisseur', 'Autre'];
// Capacité crm.write côté serveur
const WRITE_ROLES = ['ADMIN', 'DIRECTEUR', 'CHEF_DE_PROJET'];
const TABS = [['pipeline', 'Pipeline'], ['comptes', 'Comptes'], ['devis', 'Devis'], ['activites', 'Activités']];
// Capacité finance.read côté serveur : montants des devis
const FINANCE_ROLES = ['ADMIN', 'DIRECTEUR', 'CHEF_DE_PROJET'];

const money = (n) => `${Math.round(n).toLocaleString('fr-FR')} DH`;
const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const hasAmount = (v) => v != null;

function Summary({ s }) {
  if (!s) return null;
  const cards = [
    ['Opportunités ouvertes', s.open],
    ...(s.pipeline_dh !== undefined ? [['Pipeline', money(s.pipeline_dh)], ['Pondéré', money(s.weighted_dh)]] : []),
    ['Taux de réussite', s.win_rate == null ? '—' : `${s.win_rate} %`],
    ['Relances en retard', s.overdue_activities],
    ["À faire aujourd'hui", s.due_today],
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      {cards.map(([label, value]) => (
        <div key={label} className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
          <div className="text-xs text-slate-500">{label}</div>
          <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
        </div>
      ))}
    </div>
  );
}

function OpportunityForm({ accounts, onSaved, onError }) {
  const empty = { account_id: '', name: '', amount_dh: '', stage: 'Prospect', close_date: '', next_step: '' };
  const [f, setF] = useState(empty);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    try {
      await api('/crm/opportunities', { method: 'POST', body: f });
      setF(empty);
      onSaved();
    } catch (err) {
      onError(err.message);
    }
  };
  return (
    <form onSubmit={submit} className="grid gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 md:grid-cols-3">
      <select required className={inputCls} value={f.account_id} onChange={set('account_id')}>
        <option value="">Compte *</option>
        {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      <input required className={inputCls} placeholder="Nom de l'opportunité *" value={f.name} onChange={set('name')} />
      <input className={inputCls} placeholder="Montant (DH)" inputMode="decimal" value={f.amount_dh} onChange={set('amount_dh')} />
      <select className={inputCls} value={f.stage} onChange={set('stage')}>
        {STAGES.map((s) => <option key={s}>{s}</option>)}
      </select>
      <label className="block">
        <span className="text-xs text-slate-500">Date de clôture prévue</span>
        <input type="date" className={inputCls} value={f.close_date} onChange={set('close_date')} />
      </label>
      <input className={inputCls} placeholder="Prochaine étape" value={f.next_step} onChange={set('next_step')} />
      <button type="submit" className="justify-self-start rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 md:col-span-3">
        Créer l'opportunité
      </button>
    </form>
  );
}

function Pipeline({ opps, accounts, canWrite, onChange, onError }) {
  const [adding, setAdding] = useState(false);
  const move = async (o, stage) => {
    try {
      await api(`/crm/opportunities/${o.id}`, { method: 'PATCH', body: { stage } });
      onChange();
    } catch (e) {
      onError(e.message);
    }
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Pipeline de vente</h2>
        {canWrite && (
          <button
            type="button"
            onClick={() => setAdding((a) => !a)}
            className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            {adding ? 'Fermer' : '+ Opportunité'}
          </button>
        )}
      </div>
      {adding && (
        <OpportunityForm
          accounts={accounts}
          onError={onError}
          onSaved={() => { setAdding(false); onChange(); }}
        />
      )}
      <div className="grid gap-3 overflow-x-auto md:grid-cols-3 xl:grid-cols-6">
        {STAGES.map((stage) => {
          const list = opps.filter((o) => o.stage === stage);
          const total = list.reduce((s, o) => s + (o.amount_dh ?? 0), 0);
          return (
            <div key={stage} className="min-w-[200px] rounded-xl bg-slate-100/70 p-2">
              <div className="mb-2 flex items-center justify-between px-1 text-xs font-semibold">
                <span className={`rounded px-1.5 py-0.5 ${STAGE_CLS[stage]}`}>{stage}</span>
                <span className="text-slate-500">{list.length}{total ? ` · ${money(total)}` : ''}</span>
              </div>
              <div className="space-y-2">
                {list.map((o) => (
                  <div key={o.id} className="rounded-lg bg-white p-2.5 shadow-sm ring-1 ring-slate-200">
                    <div className="text-sm font-medium">{o.name}</div>
                    <div className="text-xs text-slate-500">
                      {o.account_name}{o.contact_name ? ` · ${o.contact_name}` : ''}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-600">
                      {hasAmount(o.amount_dh) && <span className="font-medium">{money(o.amount_dh)}</span>}
                      {o.close_date && <span>clôture {o.close_date}</span>}
                    </div>
                    {o.next_step && <div className="mt-1 text-xs text-slate-500">→ {o.next_step}</div>}
                    {canWrite && (
                      <select
                        value={o.stage}
                        onChange={(e) => move(o, e.target.value)}
                        className="mt-2 w-full rounded border border-slate-300 bg-white px-1 py-1 text-xs"
                      >
                        {STAGES.map((s) => <option key={s}>{s}</option>)}
                      </select>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AccountForm({ onSaved, onError }) {
  const empty = { name: '', kind: '', city: '', phone: '', email: '' };
  const [f, setF] = useState(empty);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    try {
      const row = await api('/crm/accounts', { method: 'POST', body: f });
      setF(empty);
      onSaved(row);
    } catch (err) {
      onError(err.message);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-2 rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
      <input required className={inputCls} placeholder="Nom du compte *" value={f.name} onChange={set('name')} />
      <input className={inputCls} list="crm-kinds" placeholder="Type" value={f.kind} onChange={set('kind')} />
      <datalist id="crm-kinds">{KINDS.map((k) => <option key={k} value={k} />)}</datalist>
      <input className={inputCls} placeholder="Ville" value={f.city} onChange={set('city')} />
      <input className={inputCls} placeholder="Téléphone" value={f.phone} onChange={set('phone')} />
      <input className={inputCls} type="email" placeholder="E-mail" value={f.email} onChange={set('email')} />
      <button type="submit" className="w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700">
        Créer le compte
      </button>
    </form>
  );
}

function ContactForm({ accountId, onSaved, onError }) {
  const empty = { first_name: '', last_name: '', title: '', email: '', phone: '' };
  const [f, setF] = useState(empty);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    try {
      await api(`/crm/accounts/${accountId}/contacts`, { method: 'POST', body: f });
      setF(empty);
      onSaved();
    } catch (err) {
      onError(err.message);
    }
  };
  return (
    <form onSubmit={submit} className="grid gap-2 md:grid-cols-5">
      <input className={inputCls} placeholder="Prénom" value={f.first_name} onChange={set('first_name')} />
      <input required className={inputCls} placeholder="Nom *" value={f.last_name} onChange={set('last_name')} />
      <input className={inputCls} placeholder="Fonction" value={f.title} onChange={set('title')} />
      <input className={inputCls} placeholder="E-mail" value={f.email} onChange={set('email')} />
      <div className="flex gap-2">
        <input className={inputCls} placeholder="Téléphone" value={f.phone} onChange={set('phone')} />
        <button type="submit" className="whitespace-nowrap rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700">
          Ajouter
        </button>
      </div>
    </form>
  );
}

function AccountDetail({ account, canWrite, reload, onError, onDeleted }) {
  const [adding, setAdding] = useState(false);

  const removeContact = async (c) => {
    if (!window.confirm(`Supprimer le contact ${c.last_name} ?`)) return;
    try {
      await api(`/crm/contacts/${c.id}`, { method: 'DELETE' });
      reload();
    } catch (e) {
      onError(e.message);
    }
  };

  const removeAccount = async () => {
    if (!window.confirm(`Supprimer le compte ${account.name}, ses contacts et ses opportunités ?`)) return;
    try {
      await api(`/crm/accounts/${account.id}`, { method: 'DELETE' });
      onDeleted();
    } catch (e) {
      onError(e.message);
    }
  };

  return (
    <div className="space-y-4 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{account.name}</h2>
          <p className="text-sm text-slate-500">
            {[account.kind, account.city, account.phone, account.email].filter(Boolean).join(' · ') || 'Aucune coordonnée'}
          </p>
        </div>
        {canWrite && (
          <button type="button" onClick={removeAccount} className="text-xs text-red-600 hover:underline">
            Supprimer le compte
          </button>
        )}
      </div>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Contacts ({account.contacts.length})</h3>
          {canWrite && (
            <button type="button" onClick={() => setAdding((a) => !a)} className="text-xs text-blue-600 hover:underline">
              {adding ? 'Fermer' : '+ Contact'}
            </button>
          )}
        </div>
        {adding && <ContactForm accountId={account.id} onError={onError} onSaved={() => { setAdding(false); reload(); }} />}
        {account.contacts.length === 0 && <p className="text-sm text-slate-500">Aucun contact.</p>}
        <ul className="divide-y divide-slate-100">
          {account.contacts.map((c) => (
            <li key={c.id} className="flex items-center justify-between py-1.5 text-sm">
              <span>
                <span className="font-medium">{[c.first_name, c.last_name].filter(Boolean).join(' ')}</span>
                {c.title && <span className="text-slate-500"> · {c.title}</span>}
                {c.email && <span className="text-slate-500"> · {c.email}</span>}
                {c.phone && <span className="text-slate-500"> · {c.phone}</span>}
              </span>
              {canWrite && (
                <button type="button" onClick={() => removeContact(c)} className="text-xs text-red-600 hover:underline">
                  Supprimer
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Opportunités ({account.opportunities.length})</h3>
        {account.opportunities.length === 0 && <p className="text-sm text-slate-500">Aucune opportunité.</p>}
        <ul className="divide-y divide-slate-100">
          {account.opportunities.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-sm">
              <span className="font-medium">{o.name}</span>
              <span className="flex items-center gap-2">
                {hasAmount(o.amount_dh) && <span className="tabular-nums">{money(o.amount_dh)}</span>}
                <span className={`rounded px-1.5 py-0.5 text-xs ${STAGE_CLS[o.stage]}`}>{o.stage}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Accounts({ accounts, canWrite, onChange, onError }) {
  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [adding, setAdding] = useState(false);

  const loadDetail = (id) => api(`/crm/accounts/${id}`).then(setDetail).catch((e) => onError(e.message));

  useEffect(() => {
    if (openId) loadDetail(openId);
    else setDetail(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
      <div className="space-y-3">
        {canWrite && (
          <button
            type="button"
            onClick={() => setAdding((a) => !a)}
            className="w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            {adding ? 'Fermer' : '+ Nouveau compte'}
          </button>
        )}
        {adding && (
          <AccountForm
            onError={onError}
            onSaved={(row) => { setAdding(false); setOpenId(row.id); onChange(); }}
          />
        )}
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          {accounts.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => setOpenId(a.id)}
                className={`w-full px-3 py-2 text-left text-sm hover:bg-slate-50 ${openId === a.id ? 'bg-blue-50' : ''}`}
              >
                <div className="font-medium">{a.name}</div>
                <div className="text-xs text-slate-500">
                  {a.kind || 'Sans type'} · {a.contacts} contact(s) · {a.open_opportunities} opp. ouverte(s)
                </div>
              </button>
            </li>
          ))}
          {accounts.length === 0 && <li className="px-3 py-4 text-sm text-slate-500">Aucun compte. Créez le premier.</li>}
        </ul>
      </div>
      <div>
        {!detail ? (
          <p className="text-sm text-slate-500">Sélectionnez un compte pour voir ses contacts et ses opportunités.</p>
        ) : (
          <AccountDetail
            account={detail}
            canWrite={canWrite}
            onError={onError}
            reload={() => { loadDetail(openId); onChange(); }}
            onDeleted={() => { setOpenId(null); onChange(); }}
          />
        )}
      </div>
    </div>
  );
}

function Activities({ opps, canWrite, onChange, onError }) {
  const [list, setList] = useState(null);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ type: 'Appel', subject: '', due_date: '', opportunity_id: '' });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const today = todayLocal();

  const load = () => api('/crm/activities').then(setList).catch((e) => onError(e.message));
  useEffect(() => { load(); }, []);

  const toggle = async (a) => {
    try {
      await api(`/crm/activities/${a.id}`, { method: 'PATCH', body: { done: !a.done } });
      load();
      onChange();
    } catch (e) {
      onError(e.message);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    try {
      await api('/crm/activities', { method: 'POST', body: f });
      setF({ type: 'Appel', subject: '', due_date: '', opportunity_id: '' });
      setAdding(false);
      load();
      onChange();
    } catch (err) {
      onError(err.message);
    }
  };

  if (!list) return <p className="text-slate-500">Chargement…</p>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Activités et relances</h2>
        {canWrite && (
          <button
            type="button"
            onClick={() => setAdding((a) => !a)}
            className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            {adding ? 'Fermer' : '+ Activité'}
          </button>
        )}
      </div>
      {adding && (
        <form onSubmit={submit} className="grid gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 md:grid-cols-5">
          <select className={inputCls} value={f.type} onChange={set('type')}>
            {ACTIVITY_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
          <input required className={`${inputCls} md:col-span-2`} placeholder="Sujet *" value={f.subject} onChange={set('subject')} />
          <input type="date" className={inputCls} value={f.due_date} onChange={set('due_date')} />
          <select required className={inputCls} value={f.opportunity_id} onChange={set('opportunity_id')}>
            <option value="">Opportunité *</option>
            {opps.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <button type="submit" className="justify-self-start rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 md:col-span-5">
            Enregistrer l'activité
          </button>
        </form>
      )}
      {list.length === 0 && <p className="text-sm text-slate-500">Aucune activité pour le moment.</p>}
      <ul className="divide-y divide-slate-100 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        {list.map((a) => {
          const late = !a.done && a.due_date && a.due_date < today;
          return (
            <li key={a.id} className="flex items-start gap-3 px-3 py-2.5 text-sm">
              {canWrite ? (
                <input type="checkbox" checked={a.done} onChange={() => toggle(a)} className="mt-1" />
              ) : (
                <span className="mt-1 text-slate-400">{a.done ? '✓' : '○'}</span>
              )}
              <div className="min-w-0 flex-1">
                <div className={a.done ? 'text-slate-400 line-through' : 'font-medium'}>{a.subject}</div>
                <div className="text-xs text-slate-500">
                  {a.type}
                  {a.opportunity_name ? ` · ${a.opportunity_name}` : ''}
                  {a.account_name ? ` · ${a.account_name}` : ''}
                </div>
              </div>
              {a.due_date && (
                <span className={`whitespace-nowrap text-xs ${late ? 'font-semibold text-red-600' : 'text-slate-500'}`}>
                  {late ? 'En retard · ' : ''}{a.due_date}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function Crm() {
  const [tab, setTab] = useState('pipeline');
  const [me, setMe] = useState(null);
  const [summary, setSummary] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [opps, setOpps] = useState([]);
  const [error, setError] = useState('');
  const canWrite = !!me && WRITE_ROLES.includes(me.role);
  const canAmounts = !!me && FINANCE_ROLES.includes(me.role);

  const load = () => Promise.all([
    api('/crm/summary').then(setSummary),
    api('/crm/accounts').then(setAccounts),
    api('/crm/opportunities').then(setOpps),
  ]).catch((e) => setError(e.message));

  useEffect(() => {
    load();
    api('/auth/me').then(setMe).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">CRM</h1>
      <Summary s={summary} />
      <nav className="flex gap-1 border-b border-slate-200">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`border-b-2 px-3 py-2 text-sm ${tab === key ? 'border-blue-600 font-medium text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
          >
            {label}
          </button>
        ))}
      </nav>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {tab === 'pipeline' && (
        <Pipeline opps={opps} accounts={accounts} canWrite={canWrite} onChange={load} onError={setError} />
      )}
      {tab === 'comptes' && (
        <Accounts accounts={accounts} canWrite={canWrite} onChange={load} onError={setError} />
      )}
      {tab === 'devis' && (
        <CrmQuotes opps={opps} canWrite={canWrite} canAmounts={canAmounts} onError={setError} />
      )}
      {tab === 'activites' && (
        <Activities opps={opps} canWrite={canWrite} onChange={load} onError={setError} />
      )}
    </div>
  );
}