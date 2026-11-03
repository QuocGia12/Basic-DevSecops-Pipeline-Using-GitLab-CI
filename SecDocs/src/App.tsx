import { FormEvent, useEffect, useRef, useState } from 'react';
import { ActivityItem, api, NodeItem, setAccessToken, User } from './api';

type DirectoryFile = File & { webkitRelativePath?: string };
type UploadQueueItem = { id: string; name: string; file: File; parentId?: string; status: 'queued' | 'uploading' | 'done' | 'failed' | 'canceled'; error?: string };

function AuthScreen({ onLoggedIn }: { onLoggedIn: (user: User) => void }) {
  const [register, setRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      if (register) {
        const result = await api.register({ email, password, name });
        setRegister(false);
        setName('');
        setError('Account created. Sign in to continue.');
        return result;
      }
      const result = await api.login({ email, password });
      setAccessToken(result.accessToken);
      onLoggedIn(result.user);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to continue');
    }
  }

  return <main className="auth-shell"><section className="auth-card">
    <p className="eyebrow">SECUREDOCS</p><h1>{register ? 'Create your account' : 'Welcome back'}</h1>
    <p className="muted">Your private document space.</p>
    <form onSubmit={submit}>
      {register && <label>Name<input required value={name} onChange={(event) => setName(event.target.value)} /></label>}
      <label>Email<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label>Password<input type="password" minLength={register ? 10 : 1} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      {error && <p className="message">{error}</p>}
      <button type="submit">{register ? 'Register' : 'Sign in'}</button>
    </form>
    <button className="link-button" onClick={() => { setRegister(!register); setError(''); }}>{register ? 'Already have an account? Sign in' : 'Need an account? Register'}</button>
  </section></main>;
}

function Drive({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [items, setItems] = useState<NodeItem[]>([]);
  const [folder, setFolder] = useState<string | undefined>();
  const [mode, setMode] = useState<'drive' | 'trash' | 'activity'>('drive');
  const [query, setQuery] = useState('');
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [uploadItems, setUploadItems] = useState<UploadQueueItem[]>([]);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const uploadControllers = useRef(new Map<string, AbortController>());

  async function load() {
    try {
      if (mode === 'trash') setItems((await api.trash()).items);
      else if (mode === 'drive') setItems((await api.children(folder)).items);
      else setActivities((await api.activity()).items);
      setError('');
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load files'); }
  }
  useEffect(() => { void load(); }, [folder, mode]);

  async function newFolder() {
    const name = window.prompt('Folder name');
    if (!name) return;
    try { await api.folder(name, folder); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to create folder'); }
  }

  async function upload(file: File) {
    try {
      const started = await api.uploadUrl({ name: file.name, parentId: folder, size: file.size, mimeType: file.type || 'application/octet-stream' });
      const response = await fetch(started.uploadUrl, { method: 'PUT', headers: started.headers, body: file });
      if (!response.ok) throw new Error('Storage upload failed');
      await api.confirm(started.fileId);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to upload file'); }
  }

  function updateUpload(id: string, patch: Partial<UploadQueueItem>) {
    setUploadItems((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  async function uploadQueued(item: UploadQueueItem) {
    const controller = new AbortController();
    uploadControllers.current.set(item.id, controller);
    updateUpload(item.id, { status: 'uploading', error: undefined });
    try {
      const started = await api.uploadUrl({ name: item.file.name, parentId: item.parentId, size: item.file.size, mimeType: item.file.type || 'application/octet-stream' });
      const response = await fetch(started.uploadUrl, { method: 'PUT', headers: started.headers, body: item.file, signal: controller.signal });
      if (!response.ok) throw new Error('Storage upload failed');
      await api.confirm(started.fileId);
      updateUpload(item.id, { status: 'done' });
    } catch (reason) {
      updateUpload(item.id, { status: controller.signal.aborted ? 'canceled' : 'failed', error: reason instanceof Error ? reason.message : 'Upload failed' });
    } finally {
      uploadControllers.current.delete(item.id);
    }
  }

  async function uploadFolder(files: File[]) {
    const directoryFiles = files as DirectoryFile[];
    const folders = new Map<string, string | undefined>();
    const queue: UploadQueueItem[] = [];
    for (const file of directoryFiles) {
      const relative = file.webkitRelativePath || file.name;
      const parts = relative.split('/');
      parts.pop();
      let parentId = folder;
      let path = '';
      for (const part of parts.slice(1)) {
        path = path ? `${path}/${part}` : part;
        if (!folders.has(path)) {
          const created = await api.folder(part, parentId);
          folders.set(path, created.id);
        }
        parentId = folders.get(path);
      }
      queue.push({ id: crypto.randomUUID(), name: relative, file, parentId, status: 'queued' });
    }
    setUploadItems(queue);
    let next = 0;
    const worker = async () => {
      while (next < queue.length) {
        const item = queue[next++];
        await uploadQueued(item);
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, queue.length) }, () => worker()));
    await load();
  }

  function cancelUpload(id: string) {
    uploadControllers.current.get(id)?.abort();
    updateUpload(id, { status: 'canceled' });
  }

  async function retryUpload(item: UploadQueueItem) {
    await uploadQueued({ ...item, status: 'queued' });
  }

  async function search() {
    if (!query.trim()) { setMode('drive'); return; }
    try { setItems((await api.search(query.trim())).items); setMode('drive'); setFolder(undefined); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to search'); }
  }

  async function rename(item: NodeItem) {
    const name = window.prompt('New name', item.name);
    if (!name || name === item.name) return;
    try { await api.updateNode(item.id, { name }); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to rename'); }
  }

  async function remove(item: NodeItem) {
    if (!window.confirm(`Move “${item.name}” to trash?`)) return;
    try { await api.deleteNode(item.id); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to delete'); }
  }

  async function move(item: NodeItem) {
    const destination = window.prompt('Destination folder ID (leave empty for My Drive)', item.parentId ?? '');
    if (destination === null) return;
    try { await api.updateNode(item.id, { parentId: destination.trim() || null }); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to move'); }
  }

  return <main className="drive-shell"><header><div><p className="eyebrow">SECUREDOCS</p><h1>{mode === 'trash' ? 'Trash' : mode === 'activity' ? 'Activity' : 'My Drive'}</h1></div><div className="user-area"><span>{user.name}</span><button className="secondary" onClick={onLogout}>Sign out</button></div></header>
    <section className="toolbar"><button className={mode === 'drive' ? '' : 'secondary'} onClick={() => { setMode('drive'); setFolder(undefined); }}>My Drive</button><button className="secondary" onClick={() => setMode('trash')}>Trash</button><button className="secondary" onClick={() => setMode('activity')}>Activity</button></section>
    {mode === 'drive' && <section className="toolbar"><button onClick={newFolder}>+ New folder</button><button className="secondary" onClick={() => fileInput.current?.click()}>Upload file</button><button className="secondary" onClick={() => folderInput.current?.click()}>Upload folder</button><form className="search-form" onSubmit={(event) => { event.preventDefault(); void search(); }}><input placeholder="Search by name" value={query} onChange={(event) => setQuery(event.target.value)} /><button className="secondary" type="submit">Search</button></form><input ref={fileInput} hidden type="file" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ''; }} /><input ref={folderInput} hidden type="file" {...({ webkitdirectory: '', directory: '' } as Record<string, string>)} multiple onChange={(event) => { const files = Array.from(event.target.files ?? []); if (files.length) void uploadFolder(files); event.target.value = ''; }} /></section>}
    {mode === 'drive' && folder && <button className="back" onClick={() => setFolder(undefined)}>← My Drive</button>}
    {error && <p className="message">{error}</p>}
    {uploadItems.length > 0 && <section className="upload-queue"><h2>Upload queue</h2>{uploadItems.map((item) => <div className="queue-row" key={item.id}><span>{item.name}</span><span className="muted">{item.status}{item.error ? ` — ${item.error}` : ''}</span>{item.status === 'uploading' && <button className="link-button" onClick={() => cancelUpload(item.id)}>Cancel</button>}{item.status === 'failed' && <button className="link-button" onClick={() => void retryUpload(item)}>Retry</button>}</div>)}</section>}
    {mode === 'activity' ? <section className="file-list">{activities.length === 0 ? <p className="empty">No activity yet.</p> : activities.map((item) => <div className="file-row" key={item.id}><span className="file-name">{item.action}</span><span className="muted">{new Date(item.createdAt).toLocaleString()}</span></div>)}</section> : <section className="file-list">{items.length === 0 ? <p className="empty">{mode === 'trash' ? 'Trash is empty.' : 'This folder is empty.'}</p> : items.map((item) => <div className="file-row" key={item.id}>
      <span className="file-icon">{item.type === 'folder' ? '▰' : '▱'}</span><span className="file-name">{item.name}</span><span className="file-actions">{mode === 'trash' ? <><button className="link-button" onClick={async () => { await api.restore(item.id); await load(); }}>Restore</button><button className="link-button danger" onClick={async () => { if (window.confirm('Delete forever?')) { await api.permanentDelete(item.id); await load(); } }}>Delete forever</button></> : <>{item.type === 'folder' ? <button className="link-button" onClick={() => setFolder(item.id)}>Open</button> : <><button className="link-button" onClick={async () => { const result = await api.download(item.id); window.location.assign(result.url); }}>Download</button><button className="link-button" onClick={async () => { try { const result = await api.preview(item.id); window.open(result.url, '_blank', 'noopener,noreferrer'); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Preview unavailable'); } }}>Preview</button></>}<button className="link-button" onClick={() => void rename(item)}>Rename</button><button className="link-button" onClick={() => void move(item)}>Move</button><button className="link-button danger" onClick={() => void remove(item)}>Delete</button></>}</span>
    </div>)}</section>}
  </main>;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => { if (localStorage.getItem('securedocs_access_token')) void api.me().then(setUser).catch(() => setAccessToken(null)); }, []);
  if (!user) return <AuthScreen onLoggedIn={setUser} />;
  return <Drive user={user} onLogout={() => { setAccessToken(null); setUser(null); }} />;
}
