// app/api/books/version/publish/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getRouteClient } from "@/lib/supabaseServer";
import { getAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "published_pdfs";

type PublicationVisibility = "public_open" | "internal_only";

type JsonBody = {
  version_id?: string;
  pdf_path?: string;
  visibility?: PublicationVisibility;
};

function isFile(v: unknown): v is File {
  return typeof File !== "undefined" && v instanceof File;
}

export async function POST(req: NextRequest) {
  const supabase = getRouteClient();
  const admin = getAdminClient();

  // 1) lấy user
  const {
    data: { user },
    error: uErr,
  } = await supabase.auth.getUser();

  if (uErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2) check admin
  const { data: profile, error: pErr } = await supabase
    .from("profiles")
    .select("id,system_role")
    .eq("id", user.id)
    .maybeSingle();

  if (pErr) {
    return NextResponse.json({ error: pErr.message }, { status: 500 });
  }

  if (!profile || profile.system_role !== "admin") {
    return NextResponse.json(
      { error: "Chỉ admin mới được publish sách" },
      { status: 403 }
    );
  }

  // 3) parse input
  const contentType = req.headers.get("content-type") || "";

  let versionId = "";
  let pdfPathFromBody = "";
  let visibility: PublicationVisibility = "public_open";
  let pdfFile: File | null = null;

  if (contentType.includes("multipart/form-data")) {
    const fd = await req.formData();

    versionId = (fd.get("version_id") || "").toString();
    visibility = (fd.get("visibility") as PublicationVisibility) || "public_open";

    const f = fd.get("pdf");
    pdfFile = isFile(f) ? f : null;
  } else {
    let body: JsonBody = {};

    try {
      body = await req.json();
    } catch {
      body = {};
    }

    versionId = (body.version_id || "").toString();
    pdfPathFromBody = (body.pdf_path || "").toString();
    visibility = body.visibility || "public_open";
  }

  if (!versionId) {
    return NextResponse.json(
      { error: "version_id là bắt buộc" },
      { status: 400 }
    );
  }

  if (!["public_open", "internal_only"].includes(visibility)) {
    return NextResponse.json(
      { error: "visibility không hợp lệ" },
      { status: 400 }
    );
  }

  // 4) lấy version
  const { data: version, error: vErr } = await supabase
    .from("book_versions")
    .select("id,book_id,version_no,status")
    .eq("id", versionId)
    .maybeSingle();

  if (vErr) {
    return NextResponse.json({ error: vErr.message }, { status: 500 });
  }

  if (!version) {
    return NextResponse.json(
      { error: "Không tìm thấy version" },
      { status: 404 }
    );
  }

  if (version.status === "published") {
    return NextResponse.json(
      { error: "Version này đã publish rồi" },
      { status: 400 }
    );
  }

  // 5) upload pdf nếu có
  let pdf_path = "";

  if (pdfFile) {
    const safeName = `v${version.version_no}-${version.id}.pdf`;

    pdf_path = `book/${version.book_id}/published/${safeName}`;

    const buf = Buffer.from(await pdfFile.arrayBuffer());

    const { error: upErr } = await admin.storage
      .from(BUCKET)
      .upload(pdf_path, buf, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (upErr) {
      return NextResponse.json(
        { error: "Upload PDF thất bại", detail: upErr.message },
        { status: 500 }
      );
    }
  } else {
    pdf_path = pdfPathFromBody;
  }

  if (!pdf_path) {
    return NextResponse.json(
      { error: "Thiếu pdf_path hoặc file pdf" },
      { status: 400 }
    );
  }

  // 6) deactivate publication cũ
  const { error: deErr } = await admin
    .from("book_publications")
    .update({ is_active: false })
    .eq("book_id", version.book_id)
    .eq("is_active", true);

  if (deErr) {
    return NextResponse.json(
      { error: "Không deactivate được publication cũ", detail: deErr.message },
      { status: 500 }
    );
  }

  // 7) insert publication mới
  const { data: pub, error: insErr } = await admin
    .from("book_publications")
    .insert({
      book_id: version.book_id,
      version_id: version.id,
      pdf_path,
      visibility,
      is_active: true,
      published_by: user.id,
      published_at: new Date().toISOString(),
    })
    .select("id,book_id,version_id,pdf_path,visibility,is_active,published_at")
    .maybeSingle();

  if (insErr) {
    return NextResponse.json(
      { error: "Tạo publication thất bại", detail: insErr.message },
      { status: 500 }
    );
  }

  // 8) update version
  const nowIso = new Date().toISOString();

  const { data: updated, error: verUpErr } = await supabase
    .from("book_versions")
    .update({
      status: "published",
      locked_by: user.id,
      locked_at: nowIso,
    })
    .eq("id", versionId)
    .select("id,book_id,version_no,status")
    .maybeSingle();

  if (verUpErr) {
    return NextResponse.json({ error: verUpErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    version: updated,
    publication: pub,
  });
}
