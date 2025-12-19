"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/components/AuthProvider";

type Book = {
  id: string;
  title: string;
  unit_name: string | null;
  created_at: string | null;
};

type BookVersionStatus = "draft" | "in_review" | "published" | string;

type BookVersion = {
  id: string;
  book_id: string;
  version_no: number;
  status: BookVersionStatus;
  created_at: string | null;
};

type BookRole = "viewer" | "author" | "editor" | null;

type TocItem = {
  id: string;
  parent_id: string | null;
  title: string;
  slug: string;
  order_index: number;
  created_at?: string | null;
};

type TocTreeResponse = {
  version_id: string;
  book_id: string;
  role: BookRole;
  items: TocItem[];
};

type MemberProfile = {
  id: string;
  name: string | null;
  email: string | null;
};

type Member = {
  user_id: string;
  role: "viewer" | "author" | "editor";
  profile: MemberProfile | null;
};

type MembersResponse = {
  ok: boolean;
  book_id: string;
  members: Member[];
};

const BTN =
  "inline-flex items-center justify-center px-3 py-2 rounded-lg border hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed";
const BTN_PRIMARY =
  "inline-flex items-center justify-center px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed";
const INPUT =
  "w-full border rounded-lg px-3 py-2 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-200";
const CHIP =
  "inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold";

function buildChildrenMap(items: TocItem[]) {
  const m = new Map<string | null, TocItem[]>();
  for (const it of items) {
    const key = it.parent_id ?? null;
    if (!m.has(key)) m.set(key, []);
    m.get(key)!.push(it);
  }
  for (const arr of m.values()) {
    arr.sort((a, b) => a.order_index - b.order_index);
  }
  return m;
}

function getVersionStatusLabel(status: BookVersionStatus) {
  switch (status) {
    case "draft":
      return "Bản nháp";
    case "in_review":
      return "Đang rà soát";
    case "published":
      return "Đã xuất bản";
    default:
      return status || "Không rõ";
  }
}

function getVersionStatusClass(status: BookVersionStatus) {
  switch (status) {
    case "draft":
      return `${CHIP} bg-gray-100 text-gray-800`;
    case "in_review":
      return `${CHIP} bg-blue-100 text-blue-800`;
    case "published":
      return `${CHIP} bg-green-100 text-green-800`;
    default:
      return `${CHIP} bg-gray-100 text-gray-800`;
  }
}

export default function BookDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const bookId = params.id;

  const [loading, setLoading] = useState(true);
  const [treeLoading, setTreeLoading] = useState(false);
  const [creatingVersion, setCreatingVersion] = useState(false);

  const [book, setBook] = useState<Book | null>(null);
  const [version, setVersion] = useState<BookVersion | null>(null);
  const [toc, setToc] = useState<TocTreeResponse | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [newRootTitle, setNewRootTitle] = useState("");
  const [addingRoot, setAddingRoot] = useState(false);

  // Load book + latest version
  useEffect(() => {
    if (!bookId) return;
    if (authLoading) return;

    if (!user) {
      router.push("/login");
      return;
    }

    const load = async () => {
      setLoading(true);
      setErrorMsg(null);
      try {
        // 1) Lấy thông tin book
        const { data: bk, error: bErr } = await supabase
          .from("books")
          .select("id,title,unit_name,created_at")
          .eq("id", bookId)
          .maybeSingle();

        if (bErr || !bk) {
          setErrorMsg(
            bErr?.message || "Không tìm thấy thông tin sách"
          );
          setBook(null);
          setVersion(null);
          setToc(null);
          setMembers([]);
          return;
        }

        setBook(bk as Book);

        // 2) Lấy phiên bản mới nhất
        const { data: ver, error: vErr } = await supabase
          .from("book_versions")
          .select("id,book_id,version_no,status,created_at")
          .eq("book_id", bk.id)
          .order("version_no", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (vErr) {
          setErrorMsg(
            vErr.message ||
              "Lỗi khi tải thông tin phiên bản sách"
          );
          setVersion(null);
          setToc(null);
          setMembers([]);
          return;
        }

        if (!ver) {
          // Sách chưa có phiên bản nào
          setErrorMsg(
            "Sách này chưa có phiên bản nào (book_versions trống)"
          );
          setVersion(null);
          setToc(null);
          setMembers([]);
          return;
        }

        setVersion(ver as BookVersion);
        await loadTreeAndMembers(ver.id);
      } catch (e: any) {
        setErrorMsg(
          e?.message || "Lỗi không xác định khi tải thông tin sách"
        );
        setBook(null);
        setVersion(null);
        setToc(null);
        setMembers([]);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [bookId, authLoading, user, router]);

  async function loadTreeAndMembers(versionId: string) {
    setTreeLoading(true);
    try {
      const [treeRes, memRes] = await Promise.all([
        fetch(`/api/toc/tree?version_id=${versionId}`),
        fetch(`/api/toc/members?version_id=${versionId}`),
      ]);

      if (!treeRes.ok) {
        const j = await treeRes.json().catch(() => ({}));
        throw new Error(
          j.error || `Lỗi lấy TOC (status ${treeRes.status})`
        );
      }
      const treeJson = (await treeRes.json()) as TocTreeResponse;
      setToc(treeJson);

      if (memRes.ok) {
        const memJson = (await memRes.json()) as MembersResponse;
        if (memJson.ok) {
          setMembers(memJson.members || []);
        } else {
          setMembers([]);
        }
      } else {
        setMembers([]);
      }
    } catch (e: any) {
      setErrorMsg(
        e?.message ||
          "Lỗi khi tải mục lục (TOC) hoặc danh sách thành viên"
      );
      setToc(null);
      setMembers([]);
    } finally {
      setTreeLoading(false);
    }
  }

  const childrenMap = useMemo(
    () => buildChildrenMap(toc?.items || []),
    [toc]
  );

  const isEditor = toc?.role === "editor";

  async function handleAddRootItem() {
    if (!version || !newRootTitle.trim()) return;
    setAddingRoot(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/toc/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          book_version_id: version.id,
          parent_id: null,
          title: newRootTitle.trim(),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) {
        setErrorMsg(
          j.error || "Không thêm được mục TOC mới"
        );
      } else {
        setNewRootTitle("");
        await loadTreeAndMembers(version.id);
      }
    } catch (e: any) {
      setErrorMsg(
        e?.message || "Lỗi khi thêm mục TOC mới"
      );
    } finally {
      setAddingRoot(false);
    }
  }

  function renderTocBranch(parentId: string | null, depth = 0) {
    const items = childrenMap.get(parentId) || [];
    if (!items.length) return null;

    return (
      <ul className={depth === 0 ? "space-y-1" : "ml-4 space-y-1"}>
        {items.map((it) => (
          <li key={it.id}>
            <div className="flex items-center justify-between gap-2">
              <Link
                href={`/books/${bookId}/toc/${it.id}`}
                className="text-sm text-blue-700 hover:underline"
              >
                {it.title}
              </Link>
              <span className="text-[11px] text-gray-400">
                #{it.order_index}
              </span>
            </div>
            {renderTocBranch(it.id, depth + 1)}
          </li>
        ))}
      </ul>
    );
  }

  // Tạo phiên bản đầu tiên cho sách chưa có version
  async function handleCreateFirstVersion() {
    if (!book || !user) return;
    setCreatingVersion(true);
    setErrorMsg(null);

    try {
      const { data, error } = await supabase
        .from("book_versions")
        .insert({
          book_id: book.id,
          version_no: 1,
          status: "draft",
          created_by: user.id,
        })
        .select("id,book_id,version_no,status,created_at")
        .maybeSingle();

      if (error || !data) {
        setErrorMsg(
          error?.message || "Không tạo được phiên bản đầu tiên"
        );
        return;
      }

      const ver = data as BookVersion;
      setVersion(ver);
      await loadTreeAndMembers(ver.id);
      setErrorMsg(null);
    } catch (e: any) {
      setErrorMsg(
        e?.message || "Lỗi khi tạo phiên bản đầu tiên"
      );
    } finally {
      setCreatingVersion(false);
    }
  }

  if (authLoading || loading) {
    return (
      <main className="max-w-6xl mx-auto px-4 py-8">
        <p className="text-gray-600">Đang tải...</p>
      </main>
    );
  }

  // Không tìm thấy sách
  if (!book) {
    return (
      <main className="max-w-6xl mx-auto px-4 py-8 space-y-4">
        {errorMsg && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {errorMsg}
          </div>
        )}
        <button
          className={BTN}
          onClick={() => router.push("/books")}
        >
          ← Quay lại danh sách sách
        </button>
      </main>
    );
  }

  // Sách tồn tại nhưng chưa có version nào
  if (!version) {
    return (
      <main className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        <div className="space-y-2">
          <div className="text-sm text-gray-500">
            <Link href="/books" className="hover:underline">
              Sách của tôi
            </Link>
            <span className="mx-1">/</span>
            <span className="text-gray-700">{book.title}</span>
          </div>
          <h1 className="text-2xl font-bold">{book.title}</h1>
        </div>

        {errorMsg && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {errorMsg}
          </div>
        )}

        <section className="bg-white border border-gray-200 rounded-xl shadow-sm p-4 md:p-6 space-y-4">
          <p className="text-sm text-gray-700">
            Sách này hiện chưa có phiên bản nào trong bảng{" "}
            <code className="font-mono text-xs bg-gray-100 px-1 py-0.5 rounded">
              book_versions
            </code>
            .
          </p>
          <p className="text-sm text-gray-600">
            Nếu bạn là <strong>editor</strong> hoặc có quyền phù
            hợp, hãy tạo{" "}
            <strong>phiên bản đầu tiên (version 1)</strong> để bắt
            đầu xây dựng mục lục và nội dung.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <button
              className={BTN_PRIMARY}
              onClick={handleCreateFirstVersion}
              disabled={creatingVersion}
            >
              {creatingVersion
                ? "Đang tạo phiên bản..."
                : "Tạo phiên bản đầu tiên (v1)"}
            </button>
            <button
              className={BTN}
              onClick={() => router.push("/books")}
            >
              ← Quay lại danh sách sách
            </button>
          </div>

          <p className="text-xs text-gray-400 mt-2">
            (Phân quyền thực tế sẽ do RLS trên bảng{" "}
            <code className="font-mono">book_versions</code> quyết
            định. Nếu bạn không đủ quyền, thao tác này sẽ bị Supabase
            chặn.)
          </p>
        </section>
      </main>
    );
  }

  // Có book + version → hiển thị TOC và members
  const childrenMap = useMemo(
    () => buildChildrenMap(toc?.items || []),
    [toc]
  );
  const isEditor = toc?.role === "editor";

  return (
    <main className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      {/* Header sách */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="text-sm text-gray-500">
            <Link href="/books" className="hover:underline">
              Sách của tôi
            </Link>
            <span className="mx-1">/</span>
            <span className="text-gray-700">{book.title}</span>
          </div>
          <h1 className="text-2xl font-bold">{book.title}</h1>
          <p className="text-sm text-gray-600">
            Đơn vị: {book.unit_name || "Khoa Y học cổ truyền"}
          </p>
          <div className="flex items-center gap-2 text-sm">
            <span className={getVersionStatusClass(version.status)}>
              Phiên bản {version.version_no} –{" "}
              {getVersionStatusLabel(version.status)}
            </span>
            {toc?.role && (
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-700">
                Vai trò của bạn: {toc.role}
              </span>
            )}
          </div>
          {version.created_at && (
            <p className="text-xs text-gray-500">
              Tạo phiên bản lúc:{" "}
              {new Date(version.created_at).toLocaleString()}
            </p>
          )}
        </div>

        <div className="flex flex-col items-end gap-2">
          {errorMsg && (
            <div className="max-w-xs rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
              {errorMsg}
            </div>
          )}
          <button
            className={BTN}
            onClick={() => router.push("/books")}
          >
            ← Quay lại danh sách
          </button>
        </div>
      </div>

      {/* Nội dung chính: TOC + Members */}
      <div className="grid grid-cols-1 md:grid-cols-[2fr,1fr] gap-6 items-start">
        {/* TOC */}
        <section className="bg-white border border-gray-200 rounded-xl shadow-sm p-4 md:p-6 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold text-lg">
              Mục lục (TOC) của phiên bản này
            </h2>
            {treeLoading && (
              <span className="text-xs text-gray-400">
                Đang tải mục lục...
              </span>
            )}
          </div>

          {!toc && !treeLoading && (
            <p className="text-sm text-gray-500">
              Chưa có mục lục cho phiên bản này.
            </p>
          )}

          {toc && renderTocBranch(null)}

          {isEditor && (
            <div className="mt-4 border-t pt-4 space-y-2">
              <h3 className="text-sm font-semibold text-gray-800">
                Thêm mục cấp 1 (chỉ editor)
              </h3>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  className={INPUT}
                  placeholder="Tiêu đề chương mới (cấp 1)"
                  value={newRootTitle}
                  onChange={(e) => setNewRootTitle(e.target.value)}
                />
                <button
                  className={BTN_PRIMARY}
                  onClick={handleAddRootItem}
                  disabled={
                    addingRoot ||
                    !newRootTitle.trim() ||
                    treeLoading
                  }
                >
                  {addingRoot ? "Đang thêm..." : "Thêm chương"}
                </button>
              </div>
              <p className="text-xs text-gray-500">
                Các mục con chi tiết hơn sẽ được tạo ở màn hình chi
                tiết từng mục (sub-section của author).
              </p>
            </div>
          )}
        </section>

        {/* Members & meta */}
        <section className="bg-white border border-gray-200 rounded-xl shadow-sm p-4 md:p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-lg">
              Thành viên & phân quyền
            </h2>
          </div>

          {members.length === 0 ? (
            <p className="text-sm text-gray-500">
              Chưa có thông tin thành viên hoặc bạn không có quyền
              xem danh sách này.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {members.map((m) => (
                <li
                  key={m.user_id}
                  className="flex items-start justify-between gap-2"
                >
                  <div>
                    <div className="font-medium">
                      {m.profile?.name ||
                        m.profile?.email ||
                        m.user_id}
                    </div>
                    {m.profile?.email && (
                      <div className="text-xs text-gray-500">
                        {m.profile.email}
                      </div>
                    )}
                  </div>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                    {m.role}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="pt-2 border-t text-xs text-gray-500 space-y-1">
            <div>
              ID sách: <span className="font-mono">{book.id}</span>
            </div>
            <div>
              ID phiên bản:{" "}
              <span className="font-mono">{version.id}</span>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
