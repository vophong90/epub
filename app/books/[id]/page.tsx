"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type TocItem = {
  id: string;
  parent_id: string | null;
  title: string;
  slug: string;
  order_index: number;
  created_at?: string;
};

type Assignment = {
  id: string;
  toc_item_id: string;
  user_id: string;
  role_in_item: "author" | "editor";
};

type Member = {
  user_id: string;
  role: "viewer" | "author" | "editor";
  profile: { id: string; name: string | null; email: string | null } | null;
};

function buildChildrenMap(items: TocItem[]) {
  const m = new Map<string | null, TocItem[]>();
  for (const it of items) {
    const key = it.parent_id ?? null;
    if (!m.has(key)) m.set(key, []);
    m.get(key)!.push(it);
  }
  for (const [k, arr] of m.entries()) {
    arr.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
    m.set(k, arr);
  }
  return m;
}

function safeJsonParse(s: string): { ok: true; value: any } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(s) };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Invalid JSON" };
  }
}

async function fetchJsonWithTimeout(url: string, init?: RequestInit, ms = 12000) {
  const controller = new AbortController();
  const t = window.setTimeout(() => controller.abort(), ms);

  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const json = await res.json().catch(() => ({}));
    return { res, json };
  } finally {
    window.clearTimeout(t);
  }
}

export default function TocPage() {
  const params = useParams();

  // ✅ Route này là /books/[id] => params.id (KHÔNG có bookId/versionId)
  const bookId = useMemo(() => {
    const v = (params as any)?.id;
    return typeof v === "string" ? v : "";
  }, [(params as any)?.id]);

  // ✅ versionId phải resolve từ DB (book_versions) hoặc bạn có thể đổi logic theo hệ của bạn
  const [versionId, setVersionId] = useState<string>("");

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const [role, setRole] = useState<"viewer" | "author" | "editor" | null>(null);
  const [items, setItems] = useState<TocItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<TocItem | null>(null);
  const [contentJsonText, setContentJsonText] = useState<string>(
    "{\n  \"type\": \"doc\",\n  \"content\": []\n}"
  );
  const [contentStatus, setContentStatus] = useState<string>("");
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [memberPick, setMemberPick] = useState<string>("");
  const [assignRole, setAssignRole] = useState<"author" | "editor">("author");

  const dragIdRef = useRef<string | null>(null);
  const dragFromParentRef = useRef<string | null>(null);

  const canEditToc = role === "editor";
  const canEditContent = role === "editor" || role === "author";

  async function ensureAuthed() {
    const { data, error } = await supabase.auth.getUser();
    if (error) {
      console.error("auth getUser error:", error);
      window.location.href = "/login";
      return null;
    }
    if (!data?.user) {
      window.location.href = "/login";
      return null;
    }
    return data.user;
  }

  async function resolveLatestVersionId(bid: string) {
    // Nếu hệ bạn khác (ví dụ book có default_version_id), bạn đổi chỗ này là xong.
    const { data, error } = await supabase
      .from("book_versions")
      .select("id, book_id, created_at")
      .eq("book_id", bid)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data?.id || "";
  }

  async function loadTree(vId: string) {
    setLoading(true);
    setErrorMsg("");

    const u = await ensureAuthed();
    if (!u) return;

    try {
      const { res, json } = await fetchJsonWithTimeout(
        `/api/toc/tree?version_id=${encodeURIComponent(vId)}`
      );

      if (!res.ok) {
        console.error("tree error", json);
        throw new Error(json?.error || "Không tải được TOC tree");
      }

      setRole(json.role);
      setItems(json.items || []);

      // members (phục vụ phân công)
      const m = await fetchJsonWithTimeout(
        `/api/toc/members?version_id=${encodeURIComponent(vId)}`
      );
      if (m.res.ok) setMembers(m.json.members || []);
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e?.message || "Lỗi tải TOC.");
      setRole(null);
      setItems([]);
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }

  async function loadItem(tocItemId: string) {
    try {
      const { res, json } = await fetchJsonWithTimeout(
        `/api/toc/item?toc_item_id=${encodeURIComponent(tocItemId)}`
      );
      if (!res.ok) {
        console.error("item error", json);
        throw new Error(json?.error || "Không tải được nội dung mục");
      }
      setSelectedItem(json.item);
      setAssignments(json.assignments || []);
      const c = json.content?.content_json ?? { type: "doc", content: [] };
      setContentJsonText(JSON.stringify(c, null, 2));
      setContentStatus("");
    } catch (e: any) {
      console.error(e);
      setContentStatus("Lỗi tải mục: " + (e?.message || ""));
    }
  }

  // ✅ 1) Resolve versionId từ bookId
  useEffect(() => {
    (async () => {
      try {
        if (!bookId) return;

        setLoading(true);
        setErrorMsg("");

        const u = await ensureAuthed();
        if (!u) return;

        const vId = await resolveLatestVersionId(bookId);
        if (!vId) {
          setErrorMsg("Sách này chưa có version (book_versions). Hãy tạo version trước.");
          setVersionId("");
          setLoading(false);
          return;
        }

        setVersionId(vId);

        // ✅ Sau khi có versionId, load tree luôn
        await loadTree(vId);
      } catch (e: any) {
        console.error(e);
        setErrorMsg(e?.message || "Không mở được sách.");
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  // ✅ 2) Load item khi chọn node
  useEffect(() => {
    if (!selectedId) return;
    loadItem(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const childrenMap = useMemo(() => buildChildrenMap(items), [items]);

  async function apiReorder(parent_id: string | null, ordered_ids: string[]) {
    if (!versionId) return;
    await fetchJsonWithTimeout(`/api/toc/items/reorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ book_version_id: versionId, parent_id, ordered_ids }),
    });
  }

  async function apiPatchItem(id: string, patch: Partial<TocItem>) {
    const { res, json } = await fetchJsonWithTimeout(`/api/toc/items`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...patch }),
    });
    if (!res.ok) throw new Error(json?.error || "Patch failed");
    return json?.item as TocItem | undefined;
  }

  async function onSaveContent() {
    if (!selectedId) return;
    const parsed = safeJsonParse(contentJsonText);
    if (!parsed.ok) {
      setContentStatus("JSON lỗi: " + parsed.error);
      return;
    }

    setContentStatus("Đang lưu...");
    const { res, json } = await fetchJsonWithTimeout(`/api/toc/content/upsert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toc_item_id: selectedId, content_json: parsed.value }),
    });

    if (!res.ok) {
      setContentStatus("Lưu thất bại: " + (json?.error || ""));
      return;
    }
    setContentStatus("Đã lưu");
  }

  async function onCreateItem(parent_id: string | null) {
    const title = window.prompt("Tên mục?");
    if (!title) return;
    if (!versionId) {
      alert("Thiếu versionId");
      return;
    }

    const { res, json } = await fetchJsonWithTimeout(`/api/toc/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ book_version_id: versionId, parent_id, title }),
    });

    if (!res.ok) {
      alert(json?.error || "Tạo mục thất bại");
      return;
    }
    await loadTree(versionId);
  }

  async function onRenameItem(id: string, current: string) {
    const title = window.prompt("Đổi tên mục", current);
    if (!title) return;
    try {
      await apiPatchItem(id, { title });
      if (versionId) await loadTree(versionId);
    } catch (e: any) {
      alert(e?.message || "Rename failed");
    }
  }

  async function onDeleteItem(id: string) {
    if (!confirm("Xoá mục này? (sẽ xoá cả các mục con)")) return;

    const { res, json } = await fetchJsonWithTimeout(
      `/api/toc/items?id=${encodeURIComponent(id)}`,
      { method: "DELETE" }
    );

    if (!res.ok) {
      alert(json?.error || "Delete failed");
      return;
    }

    if (selectedId === id) {
      setSelectedId(null);
      setSelectedItem(null);
    }
    if (versionId) await loadTree(versionId);
  }

  function handleDragStart(e: React.DragEvent, it: TocItem) {
    if (!canEditToc) return;
    dragIdRef.current = it.id;
    dragFromParentRef.current = it.parent_id ?? null;
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDragOver(e: React.DragEvent) {
    if (!canEditToc) return;
    e.preventDefault();
  }

  function byParentToFlat(
    byParent: Map<string | null, TocItem[]>,
    p1: string | null,
    p1Arr: TocItem[],
    p2: string | null,
    p2Arr: TocItem[]
  ) {
    const clone = new Map(byParent);
    clone.set(p1, p1Arr);
    clone.set(p2, p2Arr);
    const out: TocItem[] = [];
    for (const arr of clone.values()) out.push(...arr);
    return out;
  }

  async function handleDropOnItem(e: React.DragEvent, target: TocItem) {
    e.preventDefault();
    if (!canEditToc) return;

    const dragId = dragIdRef.current;
    if (!dragId || dragId === target.id) return;

    const dragged = items.find((x) => x.id === dragId);
    if (!dragged) return;

    const fromParent = dragged.parent_id ?? null;
    const toParent = e.ctrlKey ? target.id : target.parent_id ?? null;

    const next = items.map((x) => ({ ...x }));
    const draggedIdx = next.findIndex((x) => x.id === dragId);
    if (draggedIdx < 0) return;

    next[draggedIdx].parent_id = toParent;

    const byParent = buildChildrenMap(next);
    const fromSibs = (byParent.get(fromParent) || []).filter((x) => x.id !== dragId);
    const toSibs = byParent.get(toParent) || [];

    if (e.ctrlKey) {
      const appended = [...toSibs.filter((x) => x.id !== dragId), next[draggedIdx]];
      appended.forEach((x, idx) => (x.order_index = idx + 1));
      fromSibs.forEach((x, idx) => (x.order_index = idx + 1));
      setItems(byParentToFlat(byParent, fromParent, fromSibs, toParent, appended));
    } else {
      const targetParent = target.parent_id ?? null;
      const sibs = (byParent.get(targetParent) || []).filter((x) => x.id !== dragId);
      const targetIdx = sibs.findIndex((x) => x.id === target.id);
      const insertIdx = targetIdx >= 0 ? targetIdx : sibs.length;
      sibs.splice(insertIdx, 0, next[draggedIdx]);
      sibs.forEach((x, idx) => {
        x.parent_id = targetParent;
        x.order_index = idx + 1;
      });

      if (fromParent !== targetParent) {
        fromSibs.forEach((x, idx) => (x.order_index = idx + 1));
        setItems(byParentToFlat(byParent, fromParent, fromSibs, targetParent, sibs));
      } else {
        setItems(next);
      }
    }

    try {
      await apiPatchItem(dragId, { parent_id: toParent });

      const latestChildren = buildChildrenMap(next);
      const affectedParents = new Set<string | null>([fromParent, toParent]);

      for (const p of affectedParents) {
        const ordered = (latestChildren.get(p) || []).map((x) => x.id);
        if (ordered.length) await apiReorder(p, ordered);
      }

      if (versionId) await loadTree(versionId);
    } catch (err) {
      console.error(err);
      if (versionId) await loadTree(versionId);
    }
  }

  async function onAddAssignment() {
    if (!selectedId) return;
    if (!memberPick) return;

    const { res, json } = await fetchJsonWithTimeout(`/api/toc/assignments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toc_item_id: selectedId, user_id: memberPick, role_in_item: assignRole }),
    });

    if (!res.ok) {
      alert(json?.error || "Assign failed");
      return;
    }
    await loadItem(selectedId);
  }

  async function onRemoveAssignment(user_id: string) {
    if (!selectedId) return;

    const { res, json } = await fetchJsonWithTimeout(
      `/api/toc/assignments?toc_item_id=${encodeURIComponent(selectedId)}&user_id=${encodeURIComponent(user_id)}`,
      { method: "DELETE" }
    );

    if (!res.ok) {
      alert(json?.error || "Remove failed");
      return;
    }
    await loadItem(selectedId);
  }

  function renderNode(it: TocItem, depth: number) {
    const children = childrenMap.get(it.id) || [];
    const isSelected = selectedId === it.id;

    return (
      <div key={it.id} className="select-none">
        <div
          className={`flex items-center gap-2 rounded-lg px-2 py-1 ${
            isSelected ? "bg-blue-50" : "hover:bg-gray-50"
          }`}
          style={{ paddingLeft: 8 + depth * 14 }}
          draggable={canEditToc}
          onDragStart={(e) => handleDragStart(e, it)}
          onDragOver={handleDragOver}
          onDrop={(e) => handleDropOnItem(e, it)}
          title={
            canEditToc
              ? "Kéo thả để sắp xếp. Giữ Ctrl khi thả để đưa vào làm mục con."
              : undefined
          }
        >
          <button className="flex-1 text-left" onClick={() => setSelectedId(it.id)}>
            <span className="font-medium">{it.title}</span>
            <span className="ml-2 text-xs text-gray-500">/{it.slug}</span>
          </button>

          {canEditToc && (
            <div className="flex items-center gap-1">
              <button
                className="px-2 py-1 text-xs rounded-md border hover:bg-gray-50"
                onClick={() => onCreateItem(it.id)}
              >
                +Con
              </button>
              <button
                className="px-2 py-1 text-xs rounded-md border hover:bg-gray-50"
                onClick={() => onRenameItem(it.id, it.title)}
              >
                Sửa
              </button>
              <button
                className="px-2 py-1 text-xs rounded-md border hover:bg-gray-50"
                onClick={() => onDeleteItem(it.id)}
              >
                Xoá
              </button>
            </div>
          )}
        </div>

        {children.length > 0 && (
          <div className="mt-1">{children.map((c) => renderNode(c, depth + 1))}</div>
        )}
      </div>
    );
  }

  if (loading) return <div className="p-6">Đang tải TOC...</div>;

  if (errorMsg) {
    return (
      <div className="max-w-6xl mx-auto p-6">
        <div className="border rounded-xl p-4 bg-white">
          <div className="text-red-600 font-semibold">Lỗi</div>
          <div className="mt-2 text-sm text-gray-700">{errorMsg}</div>
          <div className="mt-4 flex gap-2">
            <button
              className="px-3 py-2 rounded-lg border hover:bg-gray-50"
              onClick={() => versionId && loadTree(versionId)}
              type="button"
            >
              Thử lại
            </button>
            <Link href={`/books`} className="px-3 py-2 rounded-lg border hover:bg-gray-50">
              ← Quay lại danh sách sách
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const roots = childrenMap.get(null) || [];

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">TOC</h1>
          <div className="text-sm text-gray-600">
            Book: <span className="font-semibold">{bookId}</span> · Version:{" "}
            <span className="font-semibold">{versionId}</span> · Role:{" "}
            <span className="font-semibold">{role}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link href={`/books`} className="px-3 py-2 rounded-lg border hover:bg-gray-50">
            ← Quay lại sách
          </Link>
          {canEditToc && (
            <button
              className="px-3 py-2 rounded-lg border hover:bg-gray-50"
              onClick={() => onCreateItem(null)}
              type="button"
            >
              + Thêm mục gốc
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Left */}
        <div className="border rounded-2xl p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="font-semibold">Mục lục</div>
            <button
              className="text-sm text-gray-600 hover:underline"
              onClick={() => versionId && loadTree(versionId)}
              type="button"
            >
              Refresh
            </button>
          </div>

          <div className="space-y-1">
            {roots.map((r) => renderNode(r, 0))}
            {!roots.length && <div className="text-gray-600">Chưa có mục nào.</div>}
          </div>

          {canEditToc && (
            <div className="mt-3 text-xs text-gray-600">
              Tip: Kéo thả để sắp xếp. <span className="font-semibold">Giữ Ctrl</span> khi thả để đưa mục vào làm con.
            </div>
          )}
        </div>

        {/* Right */}
        <div className="border rounded-2xl p-3">
          {!selectedId && <div className="text-gray-600">Chọn 1 mục ở TOC để xem / sửa nội dung.</div>}

          {selectedId && selectedItem && (
            <div className="space-y-4">
              <div>
                <div className="text-sm text-gray-500">TOC item</div>
                <div className="font-semibold text-lg">{selectedItem.title}</div>
                <div className="text-xs text-gray-500">id: {selectedItem.id}</div>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <div className="font-semibold">Nội dung (JSON - tạm thời)</div>
                  {canEditContent && (
                    <button
                      className="px-3 py-2 rounded-lg border hover:bg-gray-50"
                      onClick={onSaveContent}
                      type="button"
                    >
                      Lưu
                    </button>
                  )}
                </div>

                <textarea
                  className="w-full mt-2 border rounded-xl p-3 font-mono text-sm min-h-[220px]"
                  value={contentJsonText}
                  onChange={(e) => setContentJsonText(e.target.value)}
                  readOnly={!canEditContent}
                />

                {!!contentStatus && <div className="text-sm text-gray-600 mt-1">{contentStatus}</div>}
                <div className="text-xs text-gray-500 mt-1">
                  (Bước sau mình sẽ thay textarea này bằng TipTap editor đúng chuẩn.)
                </div>
              </div>

              {role === "editor" && (
                <div>
                  <div className="font-semibold mb-2">Phân công theo mục</div>

                  <div className="flex flex-col gap-2">
                    <div className="flex gap-2">
                      <select
                        className="flex-1 border rounded-lg px-3 py-2"
                        value={memberPick}
                        onChange={(e) => setMemberPick(e.target.value)}
                      >
                        <option value="">-- Chọn user --</option>
                        {members.map((m) => (
                          <option key={m.user_id} value={m.user_id}>
                            {(m.profile?.name || m.profile?.email || m.user_id) + ` (${m.role})`}
                          </option>
                        ))}
                      </select>

                      <select
                        className="border rounded-lg px-3 py-2"
                        value={assignRole}
                        onChange={(e) => setAssignRole(e.target.value as any)}
                      >
                        <option value="author">author</option>
                        <option value="editor">editor</option>
                      </select>

                      <button
                        className="px-3 py-2 rounded-lg border hover:bg-gray-50"
                        onClick={onAddAssignment}
                        type="button"
                      >
                        Thêm
                      </button>
                    </div>

                    <div className="space-y-2">
                      {assignments.map((a) => {
                        const prof = members.find((m) => m.user_id === a.user_id)?.profile;
                        const label = prof?.name || prof?.email || a.user_id;

                        return (
                          <div key={a.id} className="flex items-center justify-between border rounded-lg px-3 py-2">
                            <div>
                              <div className="font-medium">{label}</div>
                              <div className="text-xs text-gray-600">role_in_item: {a.role_in_item}</div>
                            </div>
                            <button
                              className="px-2 py-1 text-xs rounded-md border hover:bg-gray-50"
                              onClick={() => onRemoveAssignment(a.user_id)}
                              type="button"
                            >
                              Gỡ
                            </button>
                          </div>
                        );
                      })}

                      {!assignments.length && <div className="text-sm text-gray-600">Chưa phân công.</div>}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
