import { useState, useCallback, useEffect } from "react";
import { api, ApiError } from "@/lib/api";
import { AuthProviders, User } from "@/types";

/** Reads and removes ?verify=<token> from the address bar so the token isn't left in history or shared by accident. */
function takeVerifyToken(): string | null {
  const url = new URL(window.location.href);
  const token = url.searchParams.get("verify");
  if (!token) return null;
  url.searchParams.delete("verify");
  window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  return token;
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [providers, setProviders] = useState<AuthProviders>({ googleClientId: null, emailSignup: true });
  /** Result of opening an email verification link, shown once. */
  const [verifyOutcome, setVerifyOutcome] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    api.providers().then(setProviders).catch(() => undefined);

    const token = takeVerifyToken();
    const restore = token
      ? api
          .verifyEmail(token)
          .then(({ user }) => {
            setUser(user);
            setVerifyOutcome({ ok: true, message: "Email verified - you're signed in." });
          })
          .catch((err) =>
            setVerifyOutcome({ ok: false, message: err instanceof Error ? err.message : "Verification failed" })
          )
      : api
          .me()
          .then(({ user }) => setUser(user))
          .catch((err) => {
            if (!(err instanceof ApiError) || err.status !== 401) console.warn(err);
          });
    restore.finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { user } = await api.login(email, password);
    setUser(user);
  }, []);

  /** Creates an unverified account; the user must click the emailed link before they can sign in. */
  const signup = useCallback((name: string, email: string, password: string) => api.signup(name, email, password), []);

  const loginWithGoogle = useCallback(async (credential: string) => {
    const { user } = await api.google(credential);
    setUser(user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
    }
  }, []);

  /** Called after the account is deleted or the session is found to be invalid. */
  const clearUser = useCallback(() => setUser(null), []);

  return {
    user,
    loading,
    providers,
    verifyOutcome,
    dismissVerifyOutcome: () => setVerifyOutcome(null),
    login,
    signup,
    loginWithGoogle,
    logout,
    setUser,
    clearUser,
  };
}
