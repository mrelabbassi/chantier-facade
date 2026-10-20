import { useEffect, useState } from 'react';
import { api } from './api.js';
import { Header } from './components/Shell.jsx';
import Login from './components/Login.jsx';
import Dashboard from './components/Dashboard.jsx';
import Projects from './components/Projects.jsx';
import ProjectDetail from './components/ProjectDetail.jsx';
import Users from './components/Users.jsx';
import Crm from './components/Crm.jsx';

function parseRoute() {
  const [page, id] = window.location.hash.replace(/^#\/?/, '').split('/');
  return { page: page || 'dashboard', id };
}

export default function App() {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | anonymous | error
  const [error, setError] = useState('');
  const [route, setRoute] = useState(parseRoute);

  useEffect(() => {
    const onHash = () => setRoute(parseRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    api('/auth/me')
      .then((u) => {
        setUser(u);
        setStatus('ready');
      })
      .catch((e) => {
        if (e.status === 401) setStatus('anonymous');
        else {
          setError(e.message);
          setStatus('error');
        }
      });
  }, []);

  const signIn = (u) => {
    setUser(u);
    setStatus('ready');
    window.location.hash = '#/dashboard';
  };

  const signOut = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
    setStatus('anonymous');
  };

  if (status === 'loading') return <p className="p-10 text-center text-slate-500">Chargement…</p>;
  if (status === 'anonymous') return <Login onLogin={signIn} />;
  if (status === 'error') return <p className="p-10 text-center text-red-600">{error}</p>;

  let content;
  if (route.page === 'projects' && route.id) content = <ProjectDetail key={route.id} id={route.id} />;
  else if (route.page === 'crm') content = ['ADMIN', 'DIRECTEUR', 'CHEF_DE_PROJET', 'CONDUCTEUR'].includes(user.role)
    ? <Crm />
    : <p className="text-slate-500">Accès réservé à la direction et aux chefs de projet.</p>;
  else if (route.page === 'projects') content = <Projects />;
  else if (route.page === 'utilisateurs') content = user.role === 'ADMIN' ? <Users /> : <p className="text-slate-500">Réservé aux administrateurs.</p>;
  else content = user.role === 'POSEUR' ? <Projects /> : <Dashboard />;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <Header user={user} page={route.page} onLogout={signOut} />
      <main className="mx-auto max-w-7xl px-3 py-4 sm:px-6 sm:py-6">{content}</main>
    </div>
  );
}
