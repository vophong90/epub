// components/AuthProvider.tsx
"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "@/lib/supabaseClient";

type Profile = {
  id: string;
  email: string | null;
  name: string | null;
  system_role: string | null;
};

type AuthContextValue = {
  user: any;
  profile: Profile | null;
  loading: boolean;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  profile: null,
  loading: true,
  refresh: async () => {},
});

async function fetchProfile(userId: string, fallbackUser: any): Promise<Profile> {
  const { data: p, error } = await supabase
    .from("profiles")
    .select("id,email,name,system_role")
    .eq("id", userId)
    .maybeSingle();

  if (!error && p) {
    return {
      id: p.id,
      email: p.email,
      name: p.name,
      system_role: p.system_role ?? null,
    };
  }

  return {
    id: userId,
    email: fallbackUser?.email ?? null,
    name: (fallbackUser?.user_metadata as any)?.full_name ?? null,
    system_role: null,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const initializedRef = useRef(false);
  const currentUserIdRef = useRef<string | null>(null);

  const hydrateForUser = async (u: any, opts?: { showLoading?: boolean }) => {
    const showLoading = opts?.showLoading ?? true;

    const nextId = u?.id ?? null;

    // Nếu user không đổi thì thôi (tránh nhấp tab/focus bị nháy UI)
    if (initializedRef.current && currentUserIdRef.current === nextId) {
      // vẫn sync user object nếu cần (token refresh có thể đổi access token nhưng id giữ nguyên)
      setUser(u);
      return;
    }

    if (showLoading) setLoading(true);

    currentUserIdRef.current = nextId;
    setUser(u);

    if (!u) {
      setProfile(null);
      initializedRef.current = true;
      setLoading(false);
      return;
    }

    const p = await fetchProfile(u.id, u);
    setProfile(p);

    initializedRef.current = true;
    setLoading(false);
  };

  const refresh = async () => {
    // refresh chủ động: có loading
    const {
      data: { session },
    } = await supabase.auth.getSession();
    await hydrateForUser(session?.user ?? null, { showLoading: true });
  };

  useEffect(() => {
    let mounted = true;

    (async () => {
      // init: dùng getSession (nhẹ và ổn định hơn getUser trong client)
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!mounted) return;
      await hydrateForUser(session?.user ?? null, { showLoading: true });
    })();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      // LOG nếu muốn debug:
      // console.log("[Auth] event:", event);

      if (event === "SIGNED_OUT") {
        // có loading ngắn để UI chuyển trạng thái mượt
        hydrateForUser(null, { showLoading: true });
        return;
      }

      if (event === "SIGNED_IN" || event === "USER_UPDATED") {
        hydrateForUser(session?.user ?? null, { showLoading: true });
        return;
      }

      // Các event kiểu TOKEN_REFRESHED/INITIAL_SESSION/...:
      // KHÔNG được bật loading, chỉ sync user nhẹ
      if (session?.user) {
        hydrateForUser(session.user, { showLoading: false });
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AuthContext.Provider value={{ user, profile, loading, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
