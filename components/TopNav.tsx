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
  system_role?: string | null; // nếu bạn có
};

type AuthContextValue = {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  // chống race-condition khi auth state change liên tục
  const requestSeq = useRef(0);

  async function fetchProfile(uid: string) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id,email,name,created_at,system_role")
      .eq("id", uid)
      .maybeSingle();

    if (error) {
      // Nếu RLS chặn thì bạn sẽ thấy ở đây
      console.error("profiles select error:", error);
      return null;
    }
    return (data as Profile | null) ?? null;
  }

  const refreshProfile = async () => {
    const current = user;
    if (!current?.id) {
      setProfile(null);
      return;
    }
    const p = await fetchProfile(current.id);
    setProfile(p);
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) console.error("signOut error:", error);
    // Auth state change sẽ tự sync lại user/profile/loading
  };

  useEffect(() => {
    let mounted = true;

    const run = async () => {
      const seq = ++requestSeq.current;
      setLoading(true);

      // 1) Lấy session ban đầu
      const { data, error } = await supabase.auth.getUser();
      if (!mounted) return;

      if (error) console.warn("auth.getUser error:", error);

      const u = data?.user ?? null;
      setUser(u);

      // 2) Nếu có user => fetch profile trước khi tắt loading
      if (u?.id) {
        const p = await fetchProfile(u.id);
        if (!mounted) return;
        // chỉ apply nếu đây là request mới nhất
        if (seq === requestSeq.current) setProfile(p);
      } else {
        setProfile(null);
      }

      if (!mounted) return;
      if (seq === requestSeq.current) setLoading(false);
    };

    run();

    // 3) Subscribe auth changes
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      profile,
      loading,
      refreshProfile,
      signOut,
    }),
    [user, profile, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider />");
  return ctx;
}
