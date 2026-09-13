import type { AnalysisResult, ChatMessage, ProgressEntry, User, UserSettings } from "@/types";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  // Custom header required by the server's CSRF check on state-changing requests.
  headers.set("X-Requested-With", "skill2hire");
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");

  let res: Response;
  try {
    res = await fetch(`/api${path}`, { ...init, headers, credentials: "same-origin" });
  } catch {
    throw new ApiError(0, "Cannot reach the server. Is the backend running?");
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const fallback = res.status === 413 ? "Upload is too large for the server" : `Request failed (${res.status})`;
    throw new ApiError(res.status, data?.error?.message ?? fallback, data?.error?.code);
  }
  return data as T;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const api = {
  me: () => request<{ user: User }>("/auth/me"),
  login: (email: string, password: string) => request<{ user: User }>("/auth/login", json("POST", { email, password })),
  signup: (name: string, email: string, password: string) =>
    request<{ user: User }>("/auth/signup", json("POST", { name, email, password })),
  logout: () => request<void>("/auth/logout", json("POST")),

  getSettings: () => request<UserSettings>("/account/settings"),
  saveSettings: (s: UserSettings) => request<UserSettings>("/account/settings", json("PUT", s)),
  updateProfile: (name: string, email: string, currentPassword?: string) =>
    request<{ user: User }>("/account", json("PATCH", { name, email, currentPassword: currentPassword || undefined })),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<void>("/account/password", json("PUT", { currentPassword, newPassword })),
  deleteAccount: (currentPassword: string) => request<void>("/account", json("DELETE", { currentPassword })),

  analyze: (form: FormData) => request<{ result: AnalysisResult }>("/analyses", { method: "POST", body: form }),
  latestAnalysis: () => request<{ result: AnalysisResult | null }>("/analyses/latest"),
  history: () => request<{ analyses: ProgressEntry[] }>("/analyses"),
  getAnalysis: (id: string) => request<{ result: AnalysisResult }>(`/analyses/${encodeURIComponent(id)}`),
  deleteAnalysis: (id: string) => request<void>(`/analyses/${encodeURIComponent(id)}`, json("DELETE")),

  chat: (question: string, analysisId?: string) =>
    request<Omit<ChatMessage, "id" | "role"> & { mode: "rules" | "gemini" }>(
      "/assistant/chat",
      json("POST", { question, analysisId })
    ),
};
