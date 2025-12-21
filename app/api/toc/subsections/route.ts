// app/api/toc/subsections/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireUser, BookRole } from "../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function slugify(input: string) {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

async function ensureUniqueSlug(opts: {
  supabase: any;
  book_version_id: string;
  parent_id: string | null;
  baseSlug: string;
  excludeId?: string;
}) {
  const { supabase, book_version_id, parent_id, baseSlug, excludeId } = opts;

  const base = (baseSlug || `node-${Date.now()}`).slice(0, 80);
  let candidate = base;
  let i = 0;

  while (true) {
    let q = supabase
      .from("toc_items")
      .select("id")
      .eq("book_version_id", book_version_id)
      .eq("parent_id", parent_id)
      .eq("slug", candidate)
      .limit(1);

    if (excludeId) q = q.neq("id", excludeId);

    const { data, error } = await q.maybeSingle();
    if (error) {
      // nếu query lỗi, cứ trả candidate hiện tại để tránh crash
      return candidate;
    }
    if (!data) return candidate;

    i += 1;
    const suffix = `-${i}`;
    candidate = (base.slice(0, Math.max(1, 80 - suffix.length)) + suffix).slice(
      0,
      80
    );
  }
}

async function getParentContext(supabase: any, userId: string, parentId: string) {
  // TOC cha
  const { data: parent, error: pErr } = await supabase
    .from("toc_items")
    .select("id,book_version_id")
    .eq("id", parentId)
    .maybeSingle();

  if (pErr || !parent) {
    return {
      ok: false as const,
      res: NextResponse.json(
        { error: "Không tìm thấy mục cha (TOC parent)" },
        { status: 404 }
      ),
    };
  }

  // Version → book
  const { data: version, error: vErr } = await supabase
    .from("book_versions")
    .select("id,book_id")
    .eq("id", parent.book_version_id)
    .maybeSingle();

  if (vErr || !version?.book_id) {
    return {
      ok: false as const,
      res: NextResponse.json(
        { error: "Không tìm thấy phiên bản sách" },
        { status: 404 }
      ),
    };
  }

  // Quyền ở cấp sách
  const { data: perm, error: permErr } = await supabase
    .from("book_permissions")
    .select("role")
    .eq("book_id", version.book_id)
    .eq("user_id", userId)
    .maybeSingle();

  if (permErr || !perm?.role) {
    return {
      ok: false as const,
      res: NextResponse.json(
        { error: "Bạn không có quyền với sách này" },
        { status: 403 }
      ),
    };
  }

  const bookRole = perm.role as BookRole;

  // Assignment với mục cha
  const { data: assignment } = await supabase
    .from("toc_assignments")
    .select("id,user_id,role_in_item")
    .eq("toc_item_id", parentId)
    .eq("user_id", userId)
    .maybeSingle();

  return {
    ok: true as const,
    parent,
    version,
    bookRole,
    assignment,
  };
}

function canManageSubsections(bookRole: BookRole, assignment: any | null) {
  if (bookRole === "editor") return true;
  if (bookRole === "author" && assignment && assignment.role_in_item === "author")
    return true;
  return false;
}

type TocRow = {
  id: string;
  parent_id: string | null;
  title: string;
  slug: string;
  order_index: number;
};

type TocTreeNode = TocRow & {
  depth: number;
  children: TocTreeNode[];
};

function buildTree(rows: TocRow[], rootId: string): TocTreeNode | null {
  const byId = new Map<string, TocTreeNode>();
  for (const r of rows) {
    byId.set(r.id, { ...r, depth: 0, children: [] });
  }

  // link children
  for (const n of byId.values()) {
    if (n.parent_id && byId.has(n.parent_id)) {
      byId.get(n.parent_id)!.children.push(n);
    }
  }

  // sort children by order_index
  for (const n of byId.values()) {
    n.children.sort((a, b) => a.order_index - b.order_index);
  }

  const root = byId.get(rootId);
  if (!root) return null;

  // set depth DFS
  const dfs = (node: TocTreeNode, depth: number) => {
    node.depth = depth;
    for (const c of node.children) dfs(c, depth + 1);
  };
  dfs(root, 0);

  return root;
}

/** Fetch ALL toc_items for a version (fallback; avoids Supabase 1000-row cap) */
async function fetchAllTocItemsByVersion(
  supabase: any,
  book_version_id: string
): Promise<{ rows: TocRow[]; error: string | null }> {
  const PAGE = 1000;
  let from = 0;
  const all: TocRow[] = [];

  while (true) {
    const { data, error } = await supabase
      .from("toc_items")
      .select("id,parent_id,title,slug,order_index")
      .eq("book_version_id", book_version_id)
      .order("order_index", { ascending: true })
      .order("id", { ascending: true }) // stable ordering across pages
      .range(from, from + PAGE - 1);

    if (error) return { rows: [], error: error.message };

    const batch = (data ?? []) as TocRow[];
    all.push(...batch);

    if (batch.length < PAGE) break;
    from += PAGE;
  }

  return { rows: all, error: null };
}

/** Fetch ALL direct children under a parent (paginated for safety) */
async function fetchAllChildren(
  supabase: any,
  book_version_id: string,
  parent_id: string
): Promise<{ rows: TocRow[]; error: string | null }> {
  const PAGE = 1000;
  let from = 0;
  const all: TocRow[] = [];

  while (true) {
    const { data, error } = await supabase
      .from("toc_items")
      .select("id,parent_id,title,slug,order_index")
      .eq("book_version_id", book_version_id)
      .eq("parent_id", parent_id)
      .order("order_index", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);

    if (error) return { rows: [], error: error.message };

    const batch = (data ?? []) as TocRow[];
    all.push(...batch);

    if (batch.length < PAGE) break;
    from += PAGE;
  }

  return { rows: all, error: null };
}

/**
 * Optimized: Fetch subtree rows by root_id using RPC (recursive CTE in DB)
 * - Fast: only returns the branch
 * - Avoids 1000 row cap because RPC returns full set (still subject to PostgREST response size,
 *   but practically better than loading entire version).
 */
async function fetchSubtreeByRoot(
  supabase: any,
  root_id: string
): Promise<{ rows: TocRow[]; error: string | null; usedRpc: boolean }> {
  // Try RPC first
  const { data, error } = await supabase.rpc("toc_subtree", {
    p_root_id: root_id,
  });

  if (!error && data) {
    // data expected: [{id, parent_id, title, slug, order_index}, ...]
    const rows = (Array.isArray(data) ? data : []) as TocRow[];
    return { rows, error: null, usedRpc: true };
  }

  // If RPC missing or failed, return error to allow fallback decision upstream
  return {
    rows: [],
    error: error?.message || "RPC toc_subtree failed",
    usedRpc: false,
  };
}

/** GET:
 * - ?parent_id=... -> list con trực tiếp (compat)
 * - ?root_id=...   -> trả tree nhiều cấp (dùng cho sidebar tree)
 */
export async function GET(req: NextRequest) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const root_id = searchParams.get("root_id") || "";
  const parent_id = searchParams.get("parent_id") || "";

  if (!root_id && !parent_id) {
    return NextResponse.json(
      { error: "parent_id hoặc root_id là bắt buộc" },
      { status: 400 }
    );
  }

  // MODE TREE (optimized)
  if (root_id) {
    const ctx = await getParentContext(supabase, user!.id, root_id);
    if (!ctx.ok) return ctx.res;

    const { parent } = ctx;

    // 1) Try subtree RPC: only fetch branch
    const rpcRes = await fetchSubtreeByRoot(supabase, root_id);

    let rows: TocRow[] = [];
    if (!rpcRes.error) {
      rows = rpcRes.rows;
    } else {
      // 2) Fallback: fetch all within version (paginated) to keep system working
      const fb = await fetchAllTocItemsByVersion(supabase, parent.book_version_id);
      if (fb.error) {
        // Return the fallback error (most actionable)
        return NextResponse.json({ error: fb.error }, { status: 500 });
      }
      rows = fb.rows;
    }

    const tree = buildTree(rows, root_id);
    return NextResponse.json({
      ok: true,
      root: tree,
      meta: {
        mode: "tree",
        used_rpc: !rpcRes.error,
        note: rpcRes.error
          ? "RPC toc_subtree not available/failed; fallback to full-version fetch."
          : "Fetched subtree via RPC toc_subtree.",
      },
    });
  }

  // MODE LIST (con trực tiếp)
  const ctx = await getParentContext(supabase, user!.id, parent_id);
  if (!ctx.ok) return ctx.res;

  const { parent } = ctx;

  const { rows, error: listErr } = await fetchAllChildren(
    supabase,
    parent.book_version_id,
    parent.id
  );

  if (listErr) {
    return NextResponse.json({ error: listErr }, { status: 500 });
  }

  return NextResponse.json({ ok: true, items: rows });
}

/** POST: tạo mục con mới dưới parent_id bất kỳ */
export async function POST(req: NextRequest) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const parent_id = String(body.parent_id || "");
  const title = String(body.title || "").trim();

  if (!parent_id) {
    return NextResponse.json({ error: "parent_id là bắt buộc" }, { status: 400 });
  }
  if (!title) {
    return NextResponse.json({ error: "title là bắt buộc" }, { status: 400 });
  }

  const ctx = await getParentContext(supabase, user!.id, parent_id);
  if (!ctx.ok) return ctx.res;

  const { parent, bookRole, assignment } = ctx;

  if (!canManageSubsections(bookRole, assignment)) {
    return NextResponse.json(
      { error: "Bạn không có quyền tạo mục con trong mục này." },
      { status: 403 }
    );
  }

  // order_index = max + 1 trong cùng parent
  const { data: maxRow } = await supabase
    .from("toc_items")
    .select("order_index")
    .eq("book_version_id", parent.book_version_id)
    .eq("parent_id", parent.id)
    .order("order_index", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextOrder = (maxRow?.order_index ?? 0) + 1;

  const baseSlug = slugify(title) || `sub-${Date.now()}`;
  const slug = await ensureUniqueSlug({
    supabase,
    book_version_id: parent.book_version_id,
    parent_id: parent.id,
    baseSlug,
  });

  const { data, error: insErr } = await supabase
    .from("toc_items")
    .insert({
      book_version_id: parent.book_version_id,
      parent_id: parent.id,
      title,
      slug,
      order_index: nextOrder,
    })
    .select("id,parent_id,title,slug,order_index")
    .maybeSingle();

  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, item: data });
}

/** PATCH: đổi tên node (và tự fix slug trùng) */
export async function PATCH(req: NextRequest) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const id = String(body.id || "");
  const title = String(body.title || "").trim();

  if (!id) return NextResponse.json({ error: "id là bắt buộc" }, { status: 400 });
  if (!title)
    return NextResponse.json({ error: "title là bắt buộc" }, { status: 400 });

  // Lấy node và parent
  const { data: sub, error: sErr } = await supabase
    .from("toc_items")
    .select("id,parent_id,book_version_id,slug")
    .eq("id", id)
    .maybeSingle();

  if (sErr || !sub || !sub.parent_id) {
    return NextResponse.json({ error: "Không tìm thấy mục để sửa" }, { status: 404 });
  }

  const ctx = await getParentContext(supabase, user!.id, sub.parent_id);
  if (!ctx.ok) return ctx.res;

  const { bookRole, assignment } = ctx;
  if (!canManageSubsections(bookRole, assignment)) {
    return NextResponse.json(
      { error: "Bạn không có quyền sửa mục này." },
      { status: 403 }
    );
  }

  // Mặc định: đổi title thì đổi slug theo title, nhưng phải unique để tránh duplicate
  const baseSlug = slugify(title) || sub.slug || `sub-${Date.now()}`;
  const nextSlug = await ensureUniqueSlug({
    supabase,
    book_version_id: sub.book_version_id,
    parent_id: sub.parent_id,
    baseSlug,
    excludeId: id,
  });

  const patch: any = { title, slug: nextSlug };

  const { data, error: upErr } = await supabase
    .from("toc_items")
    .update(patch)
    .eq("id", id)
    .select("id,parent_id,title,slug,order_index")
    .maybeSingle();

  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, item: data });
}

/** DELETE: xoá node */
export async function DELETE(req: NextRequest) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id") || "";
  if (!id) return NextResponse.json({ error: "id là bắt buộc" }, { status: 400 });

  const { data: sub, error: sErr } = await supabase
    .from("toc_items")
    .select("id,parent_id,book_version_id,title")
    .eq("id", id)
    .maybeSingle();

  if (sErr || !sub || !sub.parent_id) {
    return NextResponse.json({ error: "Không tìm thấy mục để xoá" }, { status: 404 });
  }

  const ctx = await getParentContext(supabase, user!.id, sub.parent_id);
  if (!ctx.ok) return ctx.res;

  const { bookRole, assignment } = ctx;
  if (!canManageSubsections(bookRole, assignment)) {
    return NextResponse.json(
      { error: "Bạn không có quyền xoá mục này." },
      { status: 403 }
    );
  }

  const { error: delErr } = await supabase.from("toc_items").delete().eq("id", id);

  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
