// app/admin/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";

type AdminUser = {
  id: string;
  email: string | null;
  name: string | null;
  system_role: string;
  created_at: string | null;
};

type ListResponse = {
  users: AdminUser[];
  page: number;
  pageSize: number;
  total: number;
};

type SystemRole = "admin" | "viewer";
type BookRoleName = "viewer" | "author" | "editor";

type BookRole = {
  book_id: string;
  title: string;
  role: BookRoleName | null;
};

const PAGE_SIZE = 10;

const SYSTEM_ROLES: { value: SystemRole; label: string }[] = [
  { value: "admin", label: "Quản trị hệ thống" },
  { value: "viewer", label: "Người dùng thường" },
];

const BOOK_ROLES: { value: BookRoleName; label: string }[] = [
  { value: "viewer", label: "Xem (viewer)" },
  { value: "author", label: "Tác giả (author)" },
  { value: "editor", label: "Biên tập (editor)" },
];

export default function AdminPage() {
  const router = useRouter();
  const { user, profile, loading: authLoading } = useAuth();

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);

  const [createName, setCreateName] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [creating, setCreating] = useState(false);

  const [bulkUploading, setBulkUploading] = useState(false);

  // 👉 state cho modal Sửa user
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editSystemRole, setEditSystemRole] = useState<SystemRole>("viewer");
  const [bookRoles, setBookRoles] = useState<BookRole[]>([]);
  const [bookRolesLoading, setBookRolesLoading] = useState(false);
  const [editSaving, setEditSaving] = useState(false);

  const totalPages = useMemo(
    () => (total > 0 ? Math.ceil(total / PAGE_SIZE) : 1),
    [total]
  );

  // Chặn non-admin vào trang
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace("/login?redirectTo=/admin");
      return;
    }
    if (profile?.system_role !== "admin") {
      router.replace("/");
      return;
    }
    // load lần đầu
    void loadUsers(1, q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user, profile]);

  async function loadUsers(p: number, query: string) {
    try {
      setLoading(true);
      const res = await fetch(
        `/api/admin/users?page=${p}&q=${encodeURIComponent(query)}`,
        { method: "GET" }
      );
      const j = (await res.json().catch(() => ({}))) as Partial<ListResponse> & {
        error?: string;
      };
      if (!res.ok) {
        console.error("load users error:", j.error || res.status);
        alert(j.error || "Không tải được danh sách user");
        return;
      }
      setUsers(j.users || []);
      setPage(j.page ?? p);
      setTotal(j.total ?? 0);
    } finally {
      setLoading(false);
    }
  }

  async function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    await loadUsers(1, q.trim());
  }

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    const name = createName.trim();
    const email = createEmail.trim();
    if (!name || !email) {
      alert("Nhập đủ họ tên và email");
      return;
    }
    try {
      setCreating(true);
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full_name: name, email }),
      });
      const j = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        console.error("create user error:", j.error || res.status);
        alert(j.error || "Tạo user thất bại");
        return;
      }
      alert("Tạo user thành công");
      setCreateName("");
      setCreateEmail("");
      await loadUsers(1, q.trim());
    } finally {
      setCreating(false);
    }
  }

  async function handleResetPassword(u: AdminUser) {
    const label = u.email || u.name || u.id;
    const ok = confirm(
      `Đặt lại mật khẩu của ${label} về mật khẩu mặc định 12345678@ ?`
    );
    if (!ok) return;

    const res = await fetch("/api/admin/users/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile_id: u.id }), // 👈 trùng với route.ts
    });

    const j = await res.json().catch(() => ({} as any));
    if (!res.ok) {
      console.error("reset password error:", j.error || res.status);
      alert(j.error || "Đặt lại mật khẩu thất bại");
      return;
    }

    alert("Đã đặt lại mật khẩu về: 12345678@");
  }

  /** 👉 MỞ modal Sửa user: load thêm danh sách sách + role */
  async function handleEditUser(u: AdminUser) {
    setEditingUser(u);
    setEditName(u.name || "");
    setEditEmail(u.email || "");
    // nếu DB có thêm system_role khác thì anh chỉnh lại mảng SYSTEM_ROLES phía trên
    const sysRole = (u.system_role as SystemRole) || "viewer";
    setEditSystemRole(sysRole);

    setEditOpen(true);
    setBookRoles([]);
    setBookRolesLoading(true);
    try {
      const res = await fetch(`/api/admin/users/${u.id}/books`, {
        method: "GET",
      });
      const j = await res
        .json()
        .catch(() => ({ books: [] as BookRole[], error: "Parse JSON error" }));
      if (!res.ok) {
        console.error("load user books error:", j.error || res.status);
        alert(j.error || "Không tải được danh sách sách & quyền");
        return;
      }
      setBookRoles(
        Array.isArray(j.books)
          ? j.books
          : []
      );
    } finally {
      setBookRolesLoading(false);
    }
  }

  function closeEditModal() {
    setEditOpen(false);
    setEditingUser(null);
    setBookRoles([]);
    setEditSaving(false);
  }

  /** 👉 Lưu thông tin user + quyền theo sách */
  async function handleSaveEdit() {
    if (!editingUser) return;

    const name = editName.trim();
    const email = editEmail.trim();

    if (!name || !email) {
      alert("Họ tên và Email không được để trống");
      return;
    }

    try {
      setEditSaving(true);
      const body = {
        id: editingUser.id,
        full_name: name,
        email,
        system_role: editSystemRole,
        // chỉ gửi những dòng có role != null
        book_roles: bookRoles
          .filter((b) => !!b.role)
          .map((b) => ({
            book_id: b.book_id,
            role: b.role,
          })),
      };

      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        console.error("update user error:", j.error || res.status);
        alert(j.error || "Cập nhật user thất bại");
        return;
      }
      alert("Cập nhật user thành công");
      await loadUsers(page, q.trim());
      closeEditModal();
    } finally {
      setEditSaving(false);
    }
  }

  async function handleBulkFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const ok = confirm(
      "Import user hàng loạt từ file CSV? File cần 2 cột: full_name,email"
    );
    if (!ok) {
      e.target.value = "";
      return;
    }

    try {
      setBulkUploading(true);
      const fd = new FormData();
      fd.append("file", file);

      const res = await fetch("/api/admin/users/bulk", {
        method: "POST",
        body: fd,
      });
      const j = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        console.error("bulk create error:", j.error || res.status);
        alert(j.error || "Import CSV thất bại");
        return;
      }
      alert(
        `Import xong. Tạo mới: ${j.created ?? 0} user. Lỗi: ${
          (j.errors && j.errors.length) || 0
        } dòng.`
      );
      await loadUsers(1, q.trim());
    } finally {
      setBulkUploading(false);
      e.target.value = "";
    }
  }

  if (authLoading || !user || profile?.system_role !== "admin") {
    return (
      <main className="max-w-5xl mx-auto px-4 py-8">
        <p className="text-gray-600 text-sm">Đang kiểm tra quyền truy cập…</p>
      </main>
    );
  }

  return (
    <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Quản trị người dùng</h1>
        <span className="text-xs text-gray-500">
          Tổng: {total} user • Trang {page}/{totalPages || 1}
        </span>
      </div>

      {/* Bộ lọc + Import + Tạo mới */}
      <section className="grid gap-4 md:grid-cols-2">
        {/* Tìm kiếm */}
        <form
          onSubmit={handleSearchSubmit}
          className="border rounded-lg p-4 space-y-3 bg-gray-50/60"
        >
          <h2 className="text-sm font-semibold text-gray-800">
            Tìm kiếm người dùng
          </h2>
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Nhập tên hoặc email…"
            className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
          />
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            Tìm
          </button>
        </form>

        {/* Tạo mới + Import CSV */}
        <div className="space-y-4">
          <form
            onSubmit={handleCreateUser}
            className="border rounded-lg p-4 space-y-3 bg-gray-50/60"
          >
            <h2 className="text-sm font-semibold text-gray-800">
              Tạo user mới
            </h2>
            <input
              type="text"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="Họ tên đầy đủ"
              className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
            />
            <input
              type="email"
              value={createEmail}
              onChange={(e) => setCreateEmail(e.target.value)}
              placeholder="Email"
              className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
            />
            <button
              type="submit"
              disabled={creating}
              className="inline-flex items-center px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
            >
              {creating ? "Đang tạo…" : "Tạo user"}
            </button>
          </form>

          <div className="border rounded-lg p-4 space-y-2 bg-gray-50/60">
            <h2 className="text-sm font-semibold text-gray-800">
              Import user bằng CSV
            </h2>
            <p className="text-xs text-gray-500">
              File CSV có 2 cột: <code>full_name</code>, <code>email</code>.
              Không dùng dấu phẩy trong tên.
            </p>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={handleBulkFileChange}
              disabled={bulkUploading}
              className="text-sm"
            />
          </div>
        </div>
      </section>

      {/* Bảng user */}
      <section className="border rounded-lg overflow-hidden">
        <div className="bg-gray-50 border-b px-4 py-2 flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-800">
            Danh sách user
          </span>
          {loading && (
            <span className="text-xs text-gray-500">Đang tải dữ liệu…</span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">
                  Họ tên
                </th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">
                  Email
                </th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">
                  Vai trò hệ thống
                </th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">
                  Ngày tạo
                </th>
                <th className="px-3 py-2 text-right font-semibold text-gray-700">
                  Hành động
                </th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-4 text-center text-gray-500 text-sm"
                  >
                    Không có user nào.
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr key={u.id} className="border-t">
                    <td className="px-3 py-2">
                      <div className="font-medium text-gray-900">
                        {u.name || "—"}
                      </div>
                      <div className="text-xs text-gray-500 truncate max-w-xs">
                        {u.id}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-gray-800">
                      {u.email || "—"}
                    </td>
                    <td className="px-3 py-2 text-gray-800">
                      {u.system_role || "viewer"}
                    </td>
                    <td className="px-3 py-2 text-gray-800">
                      {u.created_at
                        ? new Date(u.created_at).toLocaleString("vi-VN")
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-right space-x-2">
                      <button
                        type="button"
                        onClick={() => handleEditUser(u)}
                        className="inline-flex items-center px-2 py-1 rounded-md border text-xs text-gray-700 hover:bg-gray-50"
                      >
                        Sửa
                      </button>
                      <button
                        type="button"
                        onClick={() => handleResetPassword(u)}
                        className="inline-flex items-center px-2 py-1 rounded-md border border-red-500 text-xs text-red-600 hover:bg-red-50"
                      >
                        Reset mật khẩu
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-2 border-t text-xs text-gray-600">
          <div>
            Trang {page}/{totalPages || 1}
          </div>
          <div className="space-x-2">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => loadUsers(page - 1, q.trim())}
              className="px-2 py-1 rounded border hover:bg-gray-50 disabled:opacity-50"
            >
              ← Trước
            </button>
            <button
              type="button"
              disabled={page >= totalPages || loading}
              onClick={() => loadUsers(page + 1, q.trim())}
              className="px-2 py-1 rounded border hover:bg-gray-50 disabled:opacity-50"
            >
              Sau →
            </button>
          </div>
        </div>
      </section>

      {/* 👉 Modal Sửa user */}
      {editOpen && editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-800">
                Sửa thông tin & quyền của user
              </h2>
              <button
                type="button"
                onClick={closeEditModal}
                className="text-xs text-gray-500 hover:text-gray-800"
              >
                Đóng ✕
              </button>
            </div>

            <div className="p-4 space-y-4 overflow-y-auto">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-gray-700">
                    Họ tên
                  </label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium text-gray-700">
                    Email
                  </label>
                  <input
                    type="email"
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium text-gray-700">
                    Vai trò hệ thống
                  </label>
                  <select
                    value={editSystemRole}
                    onChange={(e) =>
                      setEditSystemRole(e.target.value as SystemRole)
                    }
                    className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
                  >
                    {SYSTEM_ROLES.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-gray-800">
                    Quyền theo từng sách
                  </h3>
                  {bookRolesLoading && (
                    <span className="text-[11px] text-gray-500">
                      Đang tải danh sách sách…
                    </span>
                  )}
                </div>

                <div className="border rounded-lg max-h-64 overflow-y-auto">
                  <table className="min-w-full text-xs">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold text-gray-700">
                          Sách
                        </th>
                        <th className="px-3 py-2 text-left font-semibold text-gray-700">
                          Quyền
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {bookRoles.length === 0 ? (
                        <tr>
                          <td
                            colSpan={2}
                            className="px-3 py-3 text-center text-gray-500"
                          >
                            Không có sách nào hoặc chưa load được.
                          </td>
                        </tr>
                      ) : (
                        bookRoles.map((b) => (
                          <tr key={b.book_id} className="border-t">
                            <td className="px-3 py-2 text-gray-800">
                              {b.title}
                            </td>
                            <td className="px-3 py-2">
                              <select
                                value={b.role || ""}
                                onChange={(e) => {
                                  const value = e.target
                                    .value as BookRoleName | "";
                                  setBookRoles((prev) =>
                                    prev.map((x) =>
                                      x.book_id === b.book_id
                                        ? {
                                            ...x,
                                            role: value || null,
                                          }
                                        : x
                                    )
                                  );
                                }}
                                className="border rounded px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-blue-200 focus:border-blue-400"
                              >
                                <option value="">— Không thiết lập —</option>
                                {BOOK_ROLES.map((r) => (
                                  <option key={r.value} value={r.value}>
                                    {r.label}
                                  </option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] text-gray-500">
                  Nếu chọn “— Không thiết lập —” thì user sẽ không có dòng
                  quyền nào cho sách đó (sẽ bị xoá trong{" "}
                  <code>book_permissions</code>).
                </p>
              </div>
            </div>

            <div className="px-4 py-3 border-t flex items-center justify-between bg-gray-50">
              <button
                type="button"
                onClick={closeEditModal}
                className="px-3 py-1.5 rounded-lg border text-xs font-medium text-gray-700 hover:bg-gray-100"
              >
                Huỷ
              </button>
              <button
                type="button"
                disabled={editSaving}
                onClick={handleSaveEdit}
                className="px-3 py-1.5 rounded-lg bg-blue-600 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {editSaving ? "Đang lưu…" : "Lưu thay đổi"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
