// Small wrapper around fetch: adds the login token and turns errors into exceptions.
export type Role = 'CENTRE' | 'OFFICER' | 'QUALITY' | 'STATE';
export type User = { id: string; name: string; role: Role; districtId: string | null; centreId: string | null };

export type BatchSummary = {
  id: string;
  name: string;
  status: string;
  round: number;
  centre: string;
  candidateCount: number;
  approvedBy: string[];
  waitingForMe: boolean;
  lastReason: string | null;
  escalatedAt: string | null;
  updatedAt: string;
};

export type BatchDetail = {
  id: string;
  name: string;
  status: string;
  round: number;
  lastReason: string | null;
  escalatedAt: string | null;
  centre: string;
  candidates: {
    id: string;
    name: string;
    phone: string;
    course: string;
    grade: string;
    certificate: null | { id: string; number: string; status: string; delivery: string; deliveryAttempts: number };
  }[];
  approvals: { by: string; stage: string; at: string }[];
  timeline: { id: string; at: string; by: string; role: string; action: string; details: Record<string, unknown> | null }[];
  permissions: {
    canEdit: boolean;
    canSubmit: boolean;
    canApprove: boolean;
    canWithdraw: boolean;
    canSendBack: boolean;
    canRevoke: boolean;
  };
};

export type RowError = { row: number; field: string; message: string };

export const ROLE_LABEL: Record<Role, string> = {
  CENTRE: 'Training centre',
  OFFICER: 'District officer',
  QUALITY: 'Quality team',
  STATE: 'State office',
};

let token: string | null = sessionStorage.getItem('token');
export const getToken = () => token;

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: {
      ...(typeof options.body === 'string' && !options.headers ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? body.message ?? res.statusText, body.details);
  return body as T;
}

export async function login(userId: string): Promise<User> {
  const result = await api<{ token: string; user: User }>('/auth/login', { method: 'POST', body: JSON.stringify({ userId }) });
  token = result.token;
  sessionStorage.setItem('token', result.token);
  sessionStorage.setItem('user', JSON.stringify(result.user));
  return result.user;
}

export function savedUser(): User | null {
  try {
    return token ? (JSON.parse(sessionStorage.getItem('user') ?? 'null') as User | null) : null;
  } catch {
    return null;
  }
}

export function logout() {
  token = null;
  sessionStorage.removeItem('token');
  sessionStorage.removeItem('user');
}
