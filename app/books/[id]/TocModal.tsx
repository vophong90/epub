// app/books/[id]/TocModal.tsx
"use client";

import Link from "next/link";

const BTN =
  "inline-flex items-center justify-center rounded-lg border px-3 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50";
const BTN_PRIMARY =
  "inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50";
const BTN_DANGER =
  "inline-flex items-center justify-center rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50";

export type TocItem = {
  id: string;
  book_version_id: string;
  parent_id: string | null;
  title: string;
  slug: string;
  order_index: number;
  created_at?: string | null;
};

export type MemberProfile = {
  id: string;
  name: string | null;
  email: string | null;
};

export type Member = {
  user_id: string;
  role: "viewer" | "author" | "editor";
  profile: MemberProfile | null;
};

export type TocModalProps = {
  open: boolean;
  mode: "create" | "edit";
  parentId: string | null;
  currentItem: TocItem | null;
  title: string;
  onTitleChange: (val: string) => void;
  bookId: string;

  // assignments
  loadingAssignments: boolean;
  members: Member[];
  memberIdSet: Set<string>;
  selectedAuthorIds: string[];
  onChangeSelectedAuthors: (ids: string[]) => void;

  // search user
  userSearchQuery: string;
  onUserSearchQueryChange: (val: string) => void;
  userSearchResults: MemberProfile[];
  userSearchError: string | null;
  userSearchLoading: boolean;
  onSearchUsers: () => void;

  // actions
  modalSaving: boolean;
  modalDeleting: boolean;
  onClose: () => void;
  onSave: () => void;
  onDelete: () => void;

  // helper để hiển thị tiêu đề parent
  getParentTitleById: (id: string | null) => string;
};

export function TocModal(props: TocModalProps) {
  const {
    open,
    mode,
    parentId,
    currentItem,
    title,
    onTitleChange,
    bookId,
    loadingAssignments,
    members,
    memberIdSet,
    selectedAuthorIds,
    onChangeSelectedAuthors,
    userSearchQuery,
    onUserSearchQueryChange,
    userSearchResults,
    userSearchError,
    userSearchLoading,
    onSearchUsers,
    modalSaving,
    modalDeleting,
    onClose,
    onSave,
    onDelete,
    getParentTitleById,
  } = props;

  if (!open) return null;

  function toggleAuthor(id: string, checked: boolean) {
    if (checked) {
      if (!selectedAuthorIds.includes(id)) {
        onChangeSelectedAuthors([...selectedAuthorIds, id]);
      }
    } else {
      onChangeSelectedAuthors(
        selectedAuthorIds.filter((existing) => existing !== id)
      );
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-2xl rounded-lg bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">
            {mode === "create"
              ? parentId
                ? "Tạo mục con mới"
                : "Tạo chương mới (cấp 1)"
              : "Chỉnh sửa mục lục"}
          </h3>
          <button
            className="text-sm text-gray-500 hover:text-gray-800"
            onClick={onClose}
            disabled={modalSaving || modalDeleting}
          >
            ✕
          </button>
        </div>

        <div className="space-y-4">
          {parentId && (
            <p className="text-xs text-gray-500">
              Mục cha:{" "}
              <span className="font-medium">
                {getParentTitleById(parentId) || "(không tìm thấy)"}
              </span>
            </p>
          )}

          {/* Tiêu đề */}
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Tiêu đề
            </label>
            <input
              type="text"
              className="mt-1 w-full rounded border px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
              placeholder="Nhập tiêu đề chương / mục…"
            />
          </div>

          {/* Gán author */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700">
                Phân công tác giả cho mục này
              </label>
              {loadingAssignments && (
                <span className="text-xs text-gray-500">
                  Đang tải phân công…
                </span>
              )}
            </div>

            {/* Tìm user theo email */}
            <div className="mb-2 flex gap-2">
              <input
                type="text"
                className="w-full rounded border px-3 py-1.5 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
                placeholder="Nhập email (hoặc một phần) để tìm user…"
                value={userSearchQuery}
                onChange={(e) => onUserSearchQueryChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onSearchUsers();
                  }
                }}
              />
              <button
                type="button"
                className={BTN}
                onClick={onSearchUsers}
                disabled={userSearchLoading}
              >
                {userSearchLoading ? "Đang tìm…" : "Tìm"}
              </button>
            </div>
            {userSearchError && (
              <p className="mb-1 text-xs text-red-600">{userSearchError}</p>
            )}

            {/* Kết quả tìm kiếm (user chưa là member của sách) */}
            {userSearchResults.filter((u) => !memberIdSet.has(u.id)).length >
              0 && (
              <div className="mb-2 rounded border border-dashed border-gray-300 p-2 text-xs">
                <p className="mb-1 font-semibold text-gray-700">
                  Kết quả tìm kiếm (user chưa là thành viên sách):
                </p>
                <div className="max-h-32 space-y-1 overflow-auto">
                  {userSearchResults
                    .filter((u) => !memberIdSet.has(u.id))
                    .map((u) => (
                      <label
                        key={u.id}
                        className="flex items-center justify-between gap-2 rounded px-2 py-1 text-sm hover:bg-gray-50"
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            checked={selectedAuthorIds.includes(u.id)}
                            onChange={(e) =>
                              toggleAuthor(u.id, e.target.checked)
                            }
                          />
                          <span>
                            {u.name || "(Không tên)"}{" "}
                            <span className="text-xs text-gray-500">
                              ({u.email})
                            </span>
                          </span>
                        </div>
                        <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-indigo-700">
                          mới
                        </span>
                      </label>
                    ))}
                </div>
                <p className="mt-1 text-[11px] text-gray-500">
                  Khi lưu, các user này sẽ được thêm vào sách với vai trò{" "}
                  <strong>author</strong> và phân công cho mục này.
                </p>
              </div>
            )}

            {/* Danh sách member (ở cấp sách) */}
            {members.length === 0 ? (
              <p className="text-xs text-gray-500">
                Hiện chưa có thành viên nào ở cấp sách. Bạn có thể tìm user theo
                email ở trên và tick chọn để phân công.
              </p>
            ) : (
              <div className="max-h-48 space-y-1 overflow-auto rounded border p-2">
                {members.map((m) => (
                  <label
                    key={m.user_id}
                    className="flex items-center justify-between gap-2 rounded px-2 py-1 text-sm hover:bg-gray-50"
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={selectedAuthorIds.includes(m.user_id)}
                        onChange={(e) =>
                          toggleAuthor(m.user_id, e.target.checked)
                        }
                      />
                      <span>
                        {m.profile?.name || "(Không tên)"}{" "}
                        <span className="text-xs text-gray-500">
                          ({m.profile?.email})
                        </span>
                      </span>
                    </div>
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                      {m.role}
                    </span>
                  </label>
                ))}
              </div>
            )}
            <p className="mt-1 text-xs text-gray-500">
              Role hiển thị bên phải là vai trò ở cấp sách
              (viewer/author/editor). Phân công ở đây sẽ tạo quyền{" "}
              <strong>author</strong> cho mục lục này (và tự thêm vào sách nếu
              chưa có).
            </p>
          </div>

          {/* Link mở trang biên soạn */}
          {currentItem && (
            <div className="rounded bg-gray-50 p-2 text-xs text-gray-600">
              <span className="mr-1">Trang biên soạn nội dung:</span>
              <Link
                href={`/books/${bookId}/toc/${currentItem.id}`}
                className="text-blue-600 hover:underline"
              >
                /books/{bookId}/toc/{currentItem.id}
              </Link>
            </div>
          )}
        </div>

        {/* Footer buttons */}
        <div className="mt-5 flex items-center justify-between">
          <div className="flex gap-2">
            <button
              className={BTN}
              onClick={onClose}
              disabled={modalSaving || modalDeleting}
            >
              Hủy
            </button>
            <button
              className={BTN_PRIMARY}
              onClick={onSave}
              disabled={modalSaving || modalDeleting}
            >
              {modalSaving ? "Đang lưu…" : "Lưu"}
            </button>
          </div>
          {mode === "edit" && (
            <button
              className={BTN_DANGER}
              onClick={onDelete}
              disabled={modalSaving || modalDeleting}
            >
              {modalDeleting ? "Đang xóa…" : "Xóa mục này"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
