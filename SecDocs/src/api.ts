const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:3000/api/v1';

let accessToken = localStorage.getItem('securedocs_access_token');

export function setAccessToken(token: string | null) {
  accessToken = token;
  if (token) localStorage.setItem('securedocs_access_token', token);
  else localStorage.removeItem('securedocs_access_token');
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers, credentials: 'include' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message ?? 'Request failed');
  return body as T;
}

export const api = {
  register: (data: { email: string; password: string; name: string }) => request<{ user: User }>('/auth/register', { method: 'POST', body: JSON.stringify(data) }),
  login: (data: { email: string; password: string }) => request<{ accessToken: string; user: User }>('/auth/login', { method: 'POST', body: JSON.stringify(data) }),
  me: () => request<User>('/me'),
  children: (parentId?: string) => request<{ items: NodeItem[] }>(parentId ? `/nodes/${parentId}/children` : '/nodes/root/children'),
  folder: (name: string, parentId?: string) => request<NodeItem>('/folders', { method: 'POST', body: JSON.stringify({ name, parentId }) }),
  uploadUrl: (data: { name: string; parentId?: string; size: number; mimeType: string }) => request<{ fileId: string; uploadUrl: string; headers: Record<string, string> }>('/files/upload-url', { method: 'POST', body: JSON.stringify(data) }),
  confirm: (id: string) => request<NodeItem>(`/files/${id}/confirm`, { method: 'POST' }),
  download: (id: string) => request<{ url: string }>(`/files/${id}/download-url`),
  preview: (id: string) => request<{ url: string }>(`/files/${id}/preview-url`),
  updateNode: (id: string, data: { name?: string; parentId?: string | null }) => request<NodeItem>(`/nodes/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteNode: (id: string) => request<{ id: string }>(`/nodes/${id}`, { method: 'DELETE' }),
  trash: () => request<{ items: NodeItem[] }>('/trash'),
  restore: (id: string) => request<NodeItem>(`/nodes/${id}/restore`, { method: 'POST' }),
  permanentDelete: (id: string) => request<{ success: boolean }>(`/nodes/${id}/permanent`, { method: 'DELETE' }),
  search: (q: string) => request<{ items: NodeItem[] }>(`/search?q=${encodeURIComponent(q)}`),
  activity: () => request<{ items: ActivityItem[] }>('/me/activity'),
};

export type User = { id: string; email: string; name: string; quota_bytes: string; used_bytes: string };
export type NodeItem = { id: string; type: 'file' | 'folder'; name: string; parentId: string | null; sizeBytes: string | null; mimeType: string | null; status: string };
export type ActivityItem = { id: string; action: string; nodeId: string | null; metadata: unknown; createdAt: string };
