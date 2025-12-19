// components/AuthProvider.tsx
"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";

export type Profile = {
  id: string;
  email: string | null;
  name: string | null;
  role?: string | null;
  created_at?: string | null;
};

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id,email,name,role:system_role,created_at")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.warn("fetchProfile error:", error);
    return null;
  }
  return (data as any) ?? null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const mountedRef = useRef(true);

  async function loadProfileForUser(u: User | null) {
    if (!u) {
      setProfile(null);
      return;
    }
    const p = await fetchProfile(u.id);
    if (!mountedRef.current) return;
    setProfile(p);
  }

  async function refreshProfile() {
    await loadProfileForUser(user);
  }

  useEffect(() => {
    mountedRef.current = true;

    (async () => {
      // ✅ KHÔNG timeout, cứ để Supabase getSession bình thường
      const { data, error } = await supabase.auth.getSession();
      if (!mountedRef.current) return;

      if (error) {
        console.warn("getSession error:", error);
      }

      const s = data?.session ?? null;
      setSession(s);
      const u = s?.user ?? null;
      setUser(u);
      await loadProfileForUser(u);
      if (mountedRef.current) setLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(
      async (_event, newSession) => {
        if (!mountedRef.current) return;

        setSession(newSession);
        const nextUser = newSession?.user ?? null;
        setUser(nextUser);
        await loadProfileForUser(nextUser);
        if (mountedRef.current) setLoading(false);
      }
    );

    return () => {
      mountedRef.current = false;
      sub?.subscription?.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      session,
      profile,
      loading,
      refreshProfile,
    }),
    [user, session, profile, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export default AuthProvider;

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider />");
  return ctx;
}
