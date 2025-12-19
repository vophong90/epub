// components/AuthProvider.tsx
"use client";

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";

type Profile = {
  id: string;
  email: string | null;
  name: string | null;
  created_at?: string | null;
  system_role?: string | null;
};

type AuthContextValue = {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const requestSeq = useRef(0);

  async function fetchProfile(uid: string) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id,email,name,created_at,system_role")
      .eq("id", uid)
      .maybeSingle();

    if (error) {
      console.error("profiles select error:", error);
      return null;
    }
    return (data as Profile | null) ?? null;
  }

  const refreshProfile = async () => {
    if (!user?.id) {
      setProfile(null);
      return;
    }
    const p = await fetchProfile(user.id);
    setProfile(p);
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) console.error("signOut error:", error);
  };

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      const seq = ++requestSeq.current;
      setLoading(true);

      // ✅ an toàn: đọc session từ localStorage
      const { data, error } = await supabase.auth.getSession();
      if (!mounted) return;

      if (error) console.warn("auth.getSession error:", error);

      const u = data?.session?.user ?? null;
      setUser(u);

      if (u?.id) {
        const p = await fetchProfile(u.id);
        if (!mounted) return;
        if (seq === requestSeq.current) setProfile(p);
      } else {
        setProfile(null);
      }

      if (!mounted) return;
      if (seq === requestSeq.current) setLoading(false);
    };

    init();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const seq = ++requestSeq.current;
      if (!mounted) return;

      setLoading(true);

      const u = session?.user ?? null;
      setUser(u);

      if (u?.id) {
        const p = await fetchProfile(u.id);
        if (!mounted) return;
        if (seq === requestSeq.current) setProfile(p);
      } else {
        setProfile(null);
      }

      if (!mounted) return;
      if (seq === requestSeq.current) setLoading(false);
    });

    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, profile, loading, refreshProfile, signOut }),
    [user, profile, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider />");
  return ctx;
}

export { AuthProvider };
export default AuthProvider;
