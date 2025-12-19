// app/api/admin/users/bulk/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getRouteClient } from "@/lib/supabaseServer";
import { getAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function ensureAdmin() {
  const supabase = getRouteClient();
  const {
    data: { user },
    error: uErr,
  } = await supabase.auth.getUser();

  if (uErr || !user) {
    return {
      errorRes: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const { data: profile, error: pErr } = await supabase
    .from("profiles")
    .select("id,system_role")
    .eq("id", user.id)
    .maybeSingle();

  if (pErr) {
    return {
      errorRes: NextResponse.json(
        { error: pErr.message },
        { status: 500 }
      ),
    };
  }

  if (!profile || profile.system_role !== "admin") {
    return {
      errorRes: NextResponse.json(
        { error: "Chỉ admin mới dùng API này" },
        { status: 403 }
      ),
    };
  }

  const admin = getAdminClient();
  return { supabase, admin, user };
}

// POST /api/admin/users/bulk  (multipart/form-data, field: file)
export async function POST(req: NextRequest) {
  const check = await ensureAdmin();
  if ("errorRes" in check) return check.errorRes;
  const { admin } = check;

  const contentType = req.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json(
      { error: "Yêu cầu multipart/form-data với field 'file'" },
      { status: 400 }
    );
  }

  const fd = await req.formData();
  const file = fd.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Thiếu file CSV (field 'file')" },
      { status: 400 }
    );
  }

  const text = await file.text();
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (!lines.length) {
    return NextResponse.json(
      { error: "File CSV rỗng" },
      { status: 400 }
    );
  }

  let startIdx = 0;
  const headerCols = lines[0].split(",").map((x) => x.trim().toLowerCase());
  const hasHeader =
    headerCols.includes("full_name") || headerCols.includes("email");
  if (hasHeader) startIdx = 1;

  const created: string[] = [];
  const errors: { line: number; raw: string; error: string }[] = [];

  for (let i = startIdx; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw) continue;
    const cols = raw.split(",");
    if (cols.length < 2) {
      errors.push({ line: i + 1, raw, error: "Không đủ cột (cần full_name,email)" });
      continue;
    }
    const full_name = cols[0]?.trim();
    const email = cols[1]?.trim();

    if (!full_name || !email) {
      errors.push({
        line: i + 1,
        raw,
        error: "Thiếu full_name hoặc email",
      });
      continue;
    }

    try {
      const { data: createdUser, error: cErr } =
        await admin.auth.admin.createUser({
          email,
          email_confirm: false,
          user_metadata: { full_name },
        });

      if (cErr || !createdUser?.user) {
        errors.push({
          line: i + 1,
          raw,
          error: cErr?.message || "Tạo auth user thất bại",
        });
        continue;
      }

      const uid = createdUser.user.id;

      const { error: pErr } = await admin.from("profiles").insert({
        id: uid,
        email,
        name: full_name,
        system_role: "viewer",
      });

      if (pErr) {
        errors.push({
          line: i + 1,
          raw,
          error: "Tạo profile thất bại: " + pErr.message,
        });
        continue;
      }

      created.push(uid);
    } catch (e: any) {
      errors.push({
        line: i + 1,
        raw,
        error: e?.message || String(e),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    created: created.length,
    errors,
  });
}
