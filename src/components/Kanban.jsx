import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Field, Modal, PriorityBadge, ProgressBar, btnCls, btnGhost, fmtDate, initials, inputCls, isLate } from './ui.jsx';

export default function Kanban({ project, reload }) {
  const [columns, setColumns] = useState(project.columns);
  const [users, setUsers] = useState([]);
  const [dragId, setDragId] = useState(null);
  const [editing, setEditing] = useState(null); // null | 'new' | task
  const [error, setError] = useState('');

  useEffect(() => setColumns(project.columns), [project]);
  useEffect(() => { api('/users').then(setUsers).catch(() => {}); }, []);

  const userName = (id) => users.find((u) => u.id === id)?.name;

  const moveTask = async (taskId, columnId) => {
    const prev = columns;
    const task = prev.flatMap((c) => c.tasks).find((t) => t.id === taskId);
    if (!task || task.column_id === columnId) return;
    const target = prev.find((c) => c.id === columnId);
    const position = Math.max(0, ...target.tasks.map((t) => t.position)) + 1;
    setColumns(
      prev.map((c) => ({
        ...c,
        tasks: c.id === columnId
          ? [...c.tasks.filter((t) => t.id !== taskId), { ...task, column_id: columnId, position }]
          : c.tasks.filter((t) => t.id !== taskId),
      })),
    );
    try {
      await api(`/tasks/${taskId}`, { method: 'PATCH', body: { column_id: columnId, position } });
    } catch (e) {
      setColumns(prev);
      setError(e.message);
    }
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-500">Glissez les cartes d'une colonne à l'autre (sur mobile, utilisez le sélecteur de colonne).</p>
        <button className={btnCls} onClick={() => setEditing('new')}>+ Tâche</button>
      </div>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}

      <div className="flex snap-x gap-3 overflow-x-auto pb-4">
        {columns.map((col) => (
          <section
            key={col.id}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (dragId) moveTask(dragId, col.id);
              setDragId(null);
            }}
            className="flex w-72 shrink-0 snap-start flex-col rounded-xl bg-slate-200/60 p-2"
          >
            <header className="mb-2 flex items-center justify-between px-1">
              <h3 className="text-sm font-semibold">{col.name}</h3>
              <span className="rounded-full bg-white px-2 text-xs text-slate-500">{col.tasks.length}</span>
            </header>
            <div className="flex min-h-16 flex-col gap-2">
              {[...col.tasks].sort((a, b) => a.position - b.position).map((task) => (
                <article
                  key={task.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', task.id);
                    setDragId(task.id);
                  }}
                  onDragEnd={() => setDragId(null)}
                  onClick={() => setEditing(task)}
                  className="cursor-pointer rounded-lg bg-white p-3 shadow-sm ring-1 ring-slate-200 transition hover:ring-blue-300"
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <PriorityBadge value={task.priority} />
                    {task.repere && <span className="font-mono text-xs text-slate-500">{task.repere}</span>}
                  </div>
                  <p className="text-sm font-medium leading-snug">{task.title}</p>
                  {task.zone && <p className="mt-1 text-xs text-slate-500">📍 {task.zone}</p>}
                  <div className="mt-3">
                    <ProgressBar value={task.progress} color="bg-emerald-500" />
                    <p className="mt-1 text-right text-xs text-slate-500">{task.progress} %</p>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                    <span className={isLate(task.due_date, task.progress) ? 'font-medium text-red-600' : ''}>📅 {fmtDate(task.due_date)}</span>
                    <span>☑ {task.subtasks.filter((s) => s.done).length}/{task.subtasks.length} · 💬 {task.comments_count}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <span
                      title={userName(task.assignee_id) ?? 'Non assigné'}
                      className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-blue-100 text-[10px] font-semibold text-blue-700"
                    >
                      {initials(userName(task.assignee_id)) || '–'}
                    </span>
                    <select
                      value={task.column_id}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => moveTask(task.id, e.target.value)}
                      className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-1 py-1 text-xs"
                    >
                      {columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>

      {editing && (
        <TaskModal
          task={editing === 'new' ? null : editing}
          projectId={project.id}
          columns={columns}
          users={users}
          onClose={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function TaskModal({ task, projectId, columns, users, onClose }) {
  const isNew = !task;
  const [form, setForm] = useState(() =>
    task
      ? {
          title: task.title, repere: task.repere ?? '', zone: task.zone ?? '', assignee_id: task.assignee_id ?? '',
          priority: task.priority, due_date: task.due_date ?? '', progress: task.progress, column_id: task.column_id,
        }
      : {
          title: '', repere: '', zone: '', assignee_id: '', priority: 'Normale', due_date: '', progress: 0, column_id: columns[0].id,
        },
  );
  const [subtasks, setSubtasks] = useState(task?.subtasks ?? []);
  const [comments, setComments] = useState([]);
  const [newSub, setNewSub] = useState('');
  const [newComment, setNewComment] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (task) api(`/tasks/${task.id}/comments`).then(setComments).catch(() => {});
  }, [task?.id]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    setError('');
    const body = {
      ...form,
      repere: form.repere || null,
      zone: form.zone || null,
      assignee_id: form.assignee_id || null,
      due_date: form.due_date || null,
      progress: Number(form.progress),
    };
    try {
      if (isNew) await api(`/projects/${projectId}/tasks`, { method: 'POST', body });
      else await api(`/tasks/${task.id}`, { method: 'PATCH', body });
      onClose();
    } catch (err) {
      setError(err.message);
    }
  };

  const remove = async () => {
    if (!window.confirm('Supprimer cette tâche ?')) return;
    await api(`/tasks/${task.id}`, { method: 'DELETE' });
    onClose();
  };

  const toggleSub = async (s) => {
    const done = !s.done;
    const next = subtasks.map((x) => (x.id === s.id ? { ...x, done } : x));
    setSubtasks(next);
    // L'avancement de la tâche suit les sous-tâches cochées
    const pct = Math.round((next.filter((x) => x.done).length / next.length) * 100);
    setForm((f) => ({ ...f, progress: pct }));
    await api(`/subtasks/${s.id}`, { method: 'PATCH', body: { done } });
    await api(`/tasks/${task.id}`, { method: 'PATCH', body: { progress: pct } });
  };

  const addSub = async (e) => {
    e.preventDefault();
    if (!newSub.trim()) return;
    const s = await api(`/tasks/${task.id}/subtasks`, { method: 'POST', body: { title: newSub } });
    setSubtasks((l) => [...l, { ...s, done: !!s.done }]);
    setNewSub('');
  };

  const delSub = async (s) => {
    await api(`/subtasks/${s.id}`, { method: 'DELETE' });
    setSubtasks((l) => l.filter((x) => x.id !== s.id));
  };

  const addComment = async (e) => {
    e.preventDefault();
    if (!newComment.trim()) return;
    const c = await api(`/tasks/${task.id}/comments`, { method: 'POST', body: { body: newComment } });
    setComments((l) => [...l, c]);
    setNewComment('');
  };

  return (
    <Modal title={isNew ? 'Nouvelle tâche' : 'Détail de la tâche'} onClose={onClose}>
      <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Nom de la tâche">
            <input className={inputCls} required value={form.title} onChange={set('title')} />
          </Field>
        </div>
        <Field label="Repère"><input className={inputCls} value={form.repere} onChange={set('repere')} placeholder="FA-025" /></Field>
        <Field label="Zone"><input className={inputCls} value={form.zone} onChange={set('zone')} placeholder="Façade Nord" /></Field>
        <Field label="Responsable">
          <select className={inputCls} value={form.assignee_id} onChange={set('assignee_id')}>
            <option value="">— Non assigné —</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </Field>
        <Field label="Priorité">
          <select className={inputCls} value={form.priority} onChange={set('priority')}>
            <option>Haute</option><option>Normale</option><option>Basse</option>
          </select>
        </Field>
        <Field label="Date limite"><input className={inputCls} type="date" value={form.due_date} onChange={set('due_date')} /></Field>
        <Field label="Colonne">
          <select className={inputCls} value={form.column_id} onChange={set('column_id')}>
            {columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <div className="sm:col-span-2">
          <Field label={`Avancement : ${form.progress} %`}>
            <input type="range" min="0" max="100" step="5" value={form.progress} onChange={set('progress')} className="w-full" />
          </Field>
        </div>
        {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-2">
          {!isNew ? <button type="button" onClick={remove} className="text-sm text-red-600 hover:underline">Supprimer</button> : <span />}
          <div className="flex gap-2">
            <button type="button" className={btnGhost} onClick={onClose}>Fermer</button>
            <button className={btnCls}>{isNew ? 'Créer' : 'Enregistrer'}</button>
          </div>
        </div>
      </form>

      {!isNew && (
        <div className="mt-6 space-y-5 border-t border-slate-200 pt-4">
          <section>
            <h3 className="mb-2 text-sm font-semibold">Sous-tâches ({subtasks.filter((s) => s.done).length}/{subtasks.length})</h3>
            <ul className="space-y-1">
              {subtasks.map((s) => (
                <li key={s.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={s.done} onChange={() => toggleSub(s)} className="h-4 w-4" />
                  <span className={`flex-1 ${s.done ? 'text-slate-400 line-through' : ''}`}>{s.title}</span>
                  <button onClick={() => delSub(s)} className="text-xs text-slate-400 hover:text-red-600" aria-label="Supprimer la sous-tâche">✕</button>
                </li>
              ))}
            </ul>
            <form onSubmit={addSub} className="mt-2 flex gap-2">
              <input className={inputCls} placeholder="Nouvelle sous-tâche" value={newSub} onChange={(e) => setNewSub(e.target.value)} />
              <button className={btnGhost}>Ajouter</button>
            </form>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold">Commentaires</h3>
            <ul className="space-y-2">
              {comments.map((c) => (
                <li key={c.id} className="rounded-lg bg-slate-50 p-2 text-sm">
                  <p className="text-xs text-slate-500">
                    <strong className="text-slate-700">{c.author_name ?? 'Inconnu'}</strong> · {new Date(c.created_at).toLocaleString('fr-FR')}
                  </p>
                  <p className="whitespace-pre-wrap">{c.body}</p>
                </li>
              ))}
            </ul>
            <form onSubmit={addComment} className="mt-2 flex gap-2">
              <input className={inputCls} placeholder="Écrire un commentaire" value={newComment} onChange={(e) => setNewComment(e.target.value)} />
              <button className={btnGhost}>Envoyer</button>
            </form>
          </section>
        </div>
      )}
    </Modal>
  );
}