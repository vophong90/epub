// components/AuthProvider.tsx
"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import { supabase } from "@/lib/supabaseClient";

type Profile = {
  id: string;
  email: string | null;
  name: string | null;
  system_role: string | null; // cột thật trong DB
};

type AuthContextValue = {
  user: any;
  profile: Profile | null;
  loading: boolean;
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  profile: null,
  loading: true,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadSessionAndProfile() {
    setLoading(true);

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      setUser(null);
      setProfile(null);
      setLoading(false);
      return;
    }

    setUser(user);

    // ⚠️ CHỈ lấy các cột có thật trong bảng profiles
    const { data: p, error: pErr } = await supabase
      .from("profiles")
      .select("id,email,name,system_role")
      .eq("id", user.id)
      .maybeSingle();

    if (!pErr && p) {
      setProfile({
        id: p.id,
        email: p.email,
        name: p.name,
        system_role: p.system_role ?? null,
      });
    } else {
      // fallback tối thiểu, tránh vỡ UI
      setProfile({
        id: user.id,
        email: user.email ?? null,
        name: (user.user_metadata as any)?.full_name ?? null,
        system_role: null,
      });
    }

    setLoading(false);
  }

  useEffect(() => {
    // load lần đầu
    loadSessionAndProfile();

    // lắng nghe thay đổi auth
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, _session) => {
      loadSessionAndProfile();
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ user, profile, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
