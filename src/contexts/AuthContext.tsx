import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  loading: boolean;
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  session: null,
  loading: true,
});

async function tryBootstrapOwner(userId: string) {
  // First authenticated user claims ownership. Subsequent calls will fail due to RLS;
  // failures are expected and should be silently ignored.
  try {
    await supabase.from("app_owner").insert({ owner_user_id: userId });
  } catch {
    // Ignore: the SDK can throw only in exceptional cases; we keep this silent.
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Listener FIRST (prevents missing auth events during init)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      setLoading(false);
    });

    // THEN check for existing session
    supabase.auth
      .getSession()
      .then(({ data }) => {
        setSession(data.session ?? null);
        setUser(data.session?.user ?? null);
      })
      .finally(() => setLoading(false));

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user?.id) return;

    // Do not do any Supabase calls inside onAuthStateChange callback.
    const t = window.setTimeout(() => {
      void tryBootstrapOwner(user.id);
    }, 0);

    return () => window.clearTimeout(t);
  }, [user?.id]);

  const value = useMemo<AuthContextValue>(
    () => ({ user, session, loading }),
    [user, session, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
