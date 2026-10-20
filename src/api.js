// Authentification par cookie de session (HttpOnly) : le navigateur l'envoie automatiquement.
async function request(path, init) {
  const res = await fetch(`/api${path}`, { credentials: 'same-origin', ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? `Erreur ${res.status}`), { status: res.status });
  return data;
}

export function api(path, { method = 'GET', body } = {}) {
  return request(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

// Envoi d'un fichier brut ; les métadonnées passent dans l'URL
export function upload(path, file, params = {}) {
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v != null));
  const qs = new URLSearchParams({ ...clean, file_name: file.name });
  return request(`${path}?${qs}`, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
}
