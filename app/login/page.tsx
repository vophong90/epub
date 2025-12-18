"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const r = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);

    if (error) return setMsg(error.message);
    r.push("/books");
  }

  return (
    <div className="max-w-md mx-auto border rounded-xl p-6">
      <h1 className="text-xl font-semibold mb-4">Đăng nhập</h1>

      <form onSubmit={onLogin} className="space-y-3">
        <input className="w-full border rounded-lg px-3 py-2"
          placeholder="Email" value={email} onChange={(e)=>setEmail(e.target.value)} />
        <input className="w-full border rounded-lg px-3 py-2"
          placeholder="Mật khẩu" type="password" value={password} onChange={(e)=>setPassword(e.target.value)} />

        {msg && <div className="text-sm text-red-600">{msg}</div>}

        <button disabled={busy} className="w-full rounded-lg bg-brand text-white py-2 font-semibold disabled:opacity-50">
          {busy ? "Đang đăng nhập..." : "Đăng nhập"}
        </button>
      </form>
    </div>
  );
}
