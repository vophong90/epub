"use client";

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, sleep(ms).then(() => fallback)]);
}

async function fetchProfile(userId: string): Promise<Profile | null> {
  // profiles.id = auth.users.id
  const { data, error } = await supabase
    .from("profiles")
    .select("id,email,name,role,created_at")
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
  const lastUserIdRef = useRef<string | null>(null);

  async function refreshProfile() {
    const uid = user?.id ?? null;
    if (!uid) {
      setProfile(null);
      return;
    }
    const p = await fetchProfile(uid);
    if (!mountedRef.current) return;
    setProfile(p);
  }

  useEffect(() => {
    mountedRef.current = true;

    (async () => {
      // ✅ Quan trọng: dùng getSession (không dễ bị AuthSessionMissingError như getUser)
      // + timeout để không kẹt “Đang xác thực…”
      const sessRes = await withTimeout(supabase.auth.getSession(), 8000, { data: { session: null }, error: null } as any);

      if (!mountedRef.current) return;

      const s = sessRes?.data?.session ?? null;
      setSession(s);
      setUser(s?.user ?? null);

      // load profile nếu có user
      if (s?.user?.id) {
        lastUserIdRef.current = s.user.id;
        const p = await fetchProfile(s.user.id);
        if (!mountedRef.current) return;
        setProfile(p);
      } else {
        setProfile(null);
      }

      setLoading(false);
    })();

    // ✅ Subscribe auth changes
    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      if (!mountedRef.current) return;

      setSession(newSession);
      const nextUser = newSession?.user ?? null;
      setUser(nextUser);

      const nextUid = nextUser?.id ?? null;

      // chỉ fetch profile khi đổi user
      if (!nextUid) {
        lastUserIdRef.current = null;
        setProfile(null);
        setLoading(false);
        return;
      }

      if (lastUserIdRef.current !== nextUid) {
        lastUserIdRef.current = nextUid;
        const p = await fetchProfile(nextUid);
        if (!mountedRef.current) return;
        setProfile(p);
      }

      setLoading(false);
    });

    return () => {
      mountedRef.current = false;
      sub?.subscription?.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

// ✅ default export để import AuthProvider from "...";
export default AuthProvider;

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider />");
  return ctx;
}
