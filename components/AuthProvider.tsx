// components/AuthProvider.tsx
"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type Profile = {
  id: string;
  email: string | null;
  name: string | null;
  system_role: string; // admin/viewer/...
};

type AuthCtx = {
  user: any | null;
  profile: Profile | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
};

const Ctx = createContext<AuthCtx>({
  user: null,
  profile: null,
  loading: true,
  refreshProfile: async () => {},
});

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<any | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadProfile(u: any | null) {
    if (!u?.id) {
      setProfile(null);
      return;
    }

    const { data, error } = await supabase
      .from("profiles")
      .select("id,email,name,system_role")
      .eq("id", u.id)
      .maybeSingle();

    if (error) {
      console.error("profiles select error:", error);
      setProfile(null);
      return;
    }

    setProfile((data as Profile) ?? null);
  }

  async function refreshProfile() {
    const { data } = await supabase.auth.getUser();
    const u = data?.user ?? null;
    setUser(u);
    await loadProfile(u);
  }

  useEffect(() => {
    let mounted = true;

    (async () => {
      setLoading(true);
      const { data } = await supabase.auth.getUser();
      const u = data?.user ?? null;
      if (!mounted) return;

      setUser(u);
      await loadProfile(u);
      if (!mounted) return;
      setLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const u = session?.user ?? null;
      setUser(u);
      await loadProfile(u);
      setLoading(false);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo(() => ({ user, profile, loading, refreshProfile }), [user, profile, loading]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  return useContext(Ctx);
}
