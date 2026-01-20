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
  system_role: string | null; // cột thật trong DB
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  // loading chỉ nên "true" ở lần init hoặc khi thực sự đổi user
  const [loading, setLoading] = useState(true);
  const initializedRef = useRef(false);
  const lastUserIdRef = useRef<string | null>(null);

  async function loadSessionAndProfile(opts?: { force?: boolean }) {
    const force = opts?.force ?? false;

    // Lấy user hiện tại
    const {
      data: { user: u },
      error,
    } = await supabase.auth.getUser();

    if (error || !u) {
      // nếu trước đó đã có user thì mới cần setLoading để UI chuyển trạng thái
      if (!initializedRef.current || lastUserIdRef.current !== null) {
        setLoading(true);
      }

      setUser(null);
      setProfile(null);
      lastUserIdRef.current = null;

      initializedRef.current = true;
      setLoading(false);
      return;
    }

    const nextUserId = u.id;
    const userChanged = lastUserIdRef.current !== nextUserId;

    // Chỉ bật loading khi lần đầu, hoặc user thật sự đổi, hoặc force refresh
    if (!initializedRef.current || userChanged || force) {
      setLoading(true);
    }

    // Nếu user không đổi và không force thì thôi (tránh “nhấp tab” bị reset UI)
    if (initializedRef.current && !userChanged && !force) {
      return;
    }

    setUser(u);
    lastUserIdRef.current = nextUserId;

    // Lấy profile (chỉ cột có thật)
    const { data: p, error: pErr } = await supabase
      .from("profiles")
      .select("id,email,name,system_role")
      .eq("id", nextUserId)
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
        id: nextUserId,
        email: u.email ?? null,
        name: (u.user_metadata as any)?.full_name ?? null,
        system_role: null,
      });
    }

    initializedRef.current = true;
    setLoading(false);
  }

  useEffect(() => {
    // init lần đầu
    loadSessionAndProfile({ force: true });

    // Chỉ phản ứng với event “có ý nghĩa”, tránh refresh khi đổi tab/focus
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        loadSessionAndProfile({ force: true });
      }
      // BỎ QUA các event kiểu TOKEN_REFRESHED / INITIAL_SESSION (tùy phiên bản)
      // để tránh nhấp tab lại bị reset UI
    });

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        refresh: () => loadSessionAndProfile({ force: true }),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
