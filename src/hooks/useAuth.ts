import { useState, useCallback, useEffect } from "react";
import { api, ApiError } from "@/lib/api";
import { User } from "@/types";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Restore the session from the httpOnly cookie on page load.
  useEffect(() => {
    api
      .me()
      .then(({ user }) => setUser(user))
      .catch((err) => {
        if (!(err instanceof ApiError) || err.status !== 401) console.warn(err);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { user } = await api.login(email, password);
    setUser(user);
  }, []);

  const signup = useCallback(async (name: string, email: string, password: string) => {
    const { user } = await api.signup(name, email, password);
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

  return { user, loading, login, signup, logout, setUser, clearUser };
}
