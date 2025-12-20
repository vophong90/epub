// components/toc/TocTreeSidebar.tsx
"use client";

import { FormEvent, useMemo, useState } from "react";

const INPUT =
  "w-full border rounded-lg px-3 py-2 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-200";

export type TocTreeNode = {
  id: string;
  parent_id: string | null;
  title: string;
  order_index: number;
  depth: number; // 0 = chương
  children: TocTreeNode[];
};

type Props = {
  root: TocTreeNode | null;
  activeSectionId: string; // "root" | id
  canManageSubsections: boolean;
  loading: boolean;

  onSelectSection: (id: string) => void; // "root" hoặc toc_item_id
  onCreateChild: (parentId: string, title: string) => Promise<void> | void;
  onRenameNode: (id: string, newTitle: string) => Promise<void> | void;
  onDeleteNode: (id: string, title: string) => Promise<void> | void;
};

export function TocTreeSidebar({
  root,
  activeSectionId,
  canManageSubsections,
  loading,
  onSelectSection,
  onCreateChild,
  onRenameNode,
  onDeleteNode,
}: Props) {
  // expanded state: nodeId -> bool
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // rename UI state
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamingTitle, setRenamingTitle] = useState("");
  const [renamingSaving, setRenamingSaving] = useState(false);

  // add child UI state
  const [newChildParentId, setNewChildParentId] = useState<string | null>(null);
  const [newChildTitle, setNewChildTitle] = useState("");
  const [creatingChild, setCreatingChild] = useState(false);

  const rootTitle = root?.title || "";

  const isExpanded = (id: string) => expanded[id] ?? true; // default mở
  const toggle = (id: string) =>
    setExpanded((m) => ({ ...m, [id]: !(m[id] ?? true) }));

  async function submitRename(e: FormEvent, id: string) {
    e.preventDefault();
    const t = renamingTitle.trim();
    if (!t || renamingSaving) return;
    setRenamingSaving(true);
    try {
      await onRenameNode(id, t);
      setRenamingId(null);
      setRenamingTitle("");
    } finally {
      setRenamingSaving(false);
    }
  }

  async function submitNewChild(e: FormEvent, parentId: string) {
    e.preventDefault();
    const t = newChildTitle.trim();
    if (!t || creatingChild) return;
    setCreatingChild(true);
    try {
      await onCreateChild(parentId, t);
      setNewChildParentId(null);
      setNewChildTitle("");
      // tạo xong thì mở parent để thấy node mới
      setExpanded((m) => ({ ...m, [parentId]: true }));
    } finally {
      setCreatingChild(false);
    }
  }

  const treeReady = useMemo(() => {
    if (!root) return null;
    return root;
  }, [root]);

  function renderNode(node: TocTreeNode, numberPath: number[]): JSX.Element {
    const nodeKey = node.id;
    const hasChildren = (node.children?.length || 0) > 0;

    // label số kiểu 1.1.1...
    const label = node.depth === 0 ? "" : numberPath.join(".");

    const activeId = activeSectionId === "root" ? node.id : activeSectionId;
    const isActive = nodeKey === activeId;

    const pad = 6 + node.depth * 14;

    return (
      <div key={nodeKey} className="space-y-1">
        <div className="flex items-start gap-1 min-w-0">
          {/* Expand/collapse */}
          <button
            type="button"
            className={`mt-2 shrink-0 w-6 h-6 rounded-md border text-xs ${
              hasChildren ? "hover:bg-gray-50" : "opacity-40 cursor-default"
            }`}
            title={hasChildren ? "Mở/thu gọn" : "Không có mục con"}
            onClick={() => {
              if (hasChildren) toggle(nodeKey);
            }}
          >
            {hasChildren ? (isExpanded(nodeKey) ? "▾" : "▸") : "•"}
          </button>

          {/* Node button */}
          <button
            type="button"
            className={`flex-1 min-w-0 text-left px-2 py-1.5 rounded-md border text-sm ${
              isActive
                ? "border-blue-500 bg-blue-50 text-blue-800"
                : "border-transparent hover:bg-gray-50 text-gray-700"
            }`}
            style={{ paddingLeft: pad }}
            onClick={() => onSelectSection(nodeKey)}
          >
            {label ? <div className="text-[11px] text-gray-400">{label}</div> : null}
            <div className="font-medium truncate">{node.title}</div>
          </button>

          {/* Actions */}
          {canManageSubsections && (
            <div className="flex gap-1 shrink-0 pt-1">
              <button
                type="button"
                className="px-1.5 py-1 text-[11px] border rounded-md bg-gray-50 hover:bg-gray-100 text-gray-700"
                title="Thêm mục con"
                onClick={() => {
                  setNewChildParentId(nodeKey);
                  setNewChildTitle("");
                  // đảm bảo node đang mở để nhìn form + children
                  setExpanded((m) => ({ ...m, [nodeKey]: true }));
                }}
              >
                +
              </button>

              {/* không cho rename/xoá root-level nếu bạn muốn; hiện cho phép rename cả node depth>0,
                  còn “Chương” thường là chính node đang edit ở page khác, tuỳ bạn.
                  Ở đây: cho rename/xoá mọi node trừ root (depth 0) */}
              {node.depth > 0 && (
                <>
                  <button
                    type="button"
                    className="px-1.5 py-1 text-[11px] border rounded-md bg-gray-50 hover:bg-gray-100 text-gray-700"
                    title="Đổi tên mục"
                    onClick={() => {
                      setRenamingId(nodeKey);
                      setRenamingTitle(node.title);
                      setExpanded((m) => ({ ...m, [nodeKey]: true }));
                    }}
                  >
                    ✎
                  </button>

                  <button
                    type="button"
                    className="px-1.5 py-1 text-[11px] border rounded-md bg-red-50 hover:bg-red-100 text-red-600"
                    title="Xoá mục"
                    onClick={() => onDeleteNode(nodeKey, node.title)}
                  >
                    🗑
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Rename inline */}
        {renamingId === nodeKey && (
          <form
            className="flex items-center gap-2 text-xs ml-7"
            onSubmit={(e) => submitRename(e, nodeKey)}
          >
            <input
              className={`${INPUT} h-7 text-xs`}
              value={renamingTitle}
              onChange={(e) => setRenamingTitle(e.target.value)}
              disabled={renamingSaving}
            />
            <button
              type="submit"
              className="px-2 py-1 rounded-md bg-blue-600 text-white text-[11px] hover:bg-blue-700 disabled:opacity-50"
              disabled={renamingSaving || !renamingTitle.trim()}
            >
              Lưu
            </button>
            <button
              type="button"
              className="px-2 py-1 rounded-md border text-[11px] hover:bg-gray-50"
              onClick={() => {
                setRenamingId(null);
                setRenamingTitle("");
              }}
            >
              Hủy
            </button>
          </form>
        )}

        {/* Add child inline */}
        {newChildParentId === nodeKey && (
          <form
            className="flex items-center gap-2 text-xs ml-7"
            onSubmit={(e) => submitNewChild(e, nodeKey)}
          >
            <input
              className={`${INPUT} h-7 text-xs`}
              placeholder="Tiêu đề mục con..."
              value={newChildTitle}
              onChange={(e) => setNewChildTitle(e.target.value)}
              disabled={creatingChild}
            />
            <button
              type="submit"
              className="px-2 py-1 rounded-md bg-blue-600 text-white text-[11px] hover:bg-blue-700 disabled:opacity-50"
              disabled={creatingChild || !newChildTitle.trim()}
            >
              {creatingChild ? "Đang tạo..." : "Thêm"}
            </button>
            <button
              type="button"
              className="px-2 py-1 rounded-md border text-[11px] hover:bg-gray-50"
              onClick={() => {
                setNewChildParentId(null);
                setNewChildTitle("");
              }}
            >
              Hủy
            </button>
          </form>
        )}

        {/* Children */}
        {hasChildren && isExpanded(nodeKey) && (
          <div className="space-y-1">
            {node.children.map((c) =>
              renderNode(c, [...numberPath, c.order_index])
            )}
          </div>
        )}
      </div>
    );
  }

  // loading/empty
  if (loading) {
    return (
      <aside className="space-y-2">
        <div className="text-xs text-gray-500">Đang tải TOC...</div>
      </aside>
    );
  }

  if (!treeReady) {
    return (
      <aside className="space-y-2">
        <div className="text-xs text-gray-500">
          Chưa có dữ liệu TOC cho chương này.
        </div>
      </aside>
    );
  }

  return (
    <aside className="space-y-3 min-w-0">
      {/* Header */}
      <div className="space-y-1">
        <div className="text-xs text-gray-500">Chương</div>
        <div className="font-semibold text-sm text-gray-900 truncate">
          {rootTitle}
        </div>
      </div>

      {/* “Root content” selector: vẫn chọn node root để edit phần chương */}
      <button
        type="button"
        className={`w-full text-left px-2 py-2 rounded-md border text-sm ${
          activeSectionId === "root"
            ? "border-blue-500 bg-blue-50 text-blue-800"
            : "border-transparent hover:bg-gray-50 text-gray-700"
        }`}
        onClick={() => onSelectSection("root")}
      >
        <div className="text-[11px] text-gray-400">Nội dung chương</div>
        <div className="font-medium truncate">{rootTitle}</div>
      </button>

      {/* Tree */}
      <div className="space-y-1">{renderNode(treeReady, [])}</div>
    </aside>
  );
}
