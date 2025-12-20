// components/toc/TocTreeSidebar.tsx
"use client";

import { useState, FormEvent } from "react";

export type TocTreeNode = {
  id: string;
  parent_id: string | null;
  title: string;
  order_index: number;
  depth: number;
  children: TocTreeNode[];
};

const INPUT =
  "w-full border rounded-lg px-3 py-2 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-200";

type Props = {
  root: TocTreeNode | null;
  activeSectionId: string | null;
  canManageSubsections: boolean;
  onSelectSection: (id: string) => void;
  onCreateChild: (parentId: string, title: string) => Promise<void> | void;
  onRenameNode: (id: string, newTitle: string) => Promise<void> | void;
  onDeleteNode: (id: string, title: string) => Promise<void> | void;
};

export function TocTreeSidebar({
  root,
  activeSectionId,
  canManageSubsections,
  onSelectSection,
  onCreateChild,
  onRenameNode,
  onDeleteNode,
}: Props) {
  // state UI cho rename + add child
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamingTitle, setRenamingTitle] = useState("");
  const [renamingSaving, setRenamingSaving] = useState(false);

  const [newChildParentId, setNewChildParentId] = useState<string | null>(null);
  const [newChildTitle, setNewChildTitle] = useState("");
  const [creatingChild, setCreatingChild] = useState(false);

  async function handleSubmitRename(e: FormEvent, nodeId: string) {
    e.preventDefault();
    if (!renamingTitle.trim() || renamingSaving) return;
    setRenamingSaving(true);
    try {
      await onRenameNode(nodeId, renamingTitle.trim());
      setRenamingId(null);
      setRenamingTitle("");
    } finally {
      setRenamingSaving(false);
    }
  }

  async function handleSubmitNewChild(e: FormEvent, parentId: string) {
    e.preventDefault();
    if (!newChildTitle.trim() || creatingChild) return;
    setCreatingChild(true);
    try {
      await onCreateChild(parentId, newChildTitle.trim());
      setNewChildParentId(null);
      setNewChildTitle("");
    } finally {
      setCreatingChild(false);
    }
  }

  function renderNode(node: TocTreeNode): JSX.Element {
    const isActive = node.id === activeSectionId;
    const isRoot = node.parent_id === null;
    const canRenameHere = canManageSubsections && !isRoot;
    const canDeleteHere = canManageSubsections && !isRoot;
    const canAddChildHere = canManageSubsections;
    const paddingLeft = 8 + node.depth * 12;

    return (
      <div key={node.id} className="space-y-1">
        {/* Hàng chính */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={`flex-1 text-left px-2 py-1.5 rounded-md border text-sm ${
              isActive
                ? "border-blue-500 bg-blue-50 text-blue-800"
                : "border-transparent hover:bg-gray-50 text-gray-700"
            }`}
            style={{ paddingLeft }}
            onClick={() => onSelectSection(node.id)}
          >
            <div className="text-[11px] text-gray-400">
              {node.depth === 0 ? "Chương" : `Mục #${node.order_index}`}
            </div>
            <div className="font-medium truncate">{node.title}</div>
          </button>

          {canAddChildHere && (
            <button
              type="button"
              className="px-1.5 py-1 text-[11px] border rounded-md bg-gray-50 hover:bg-gray-100 text-gray-700"
              title="Thêm mục con"
              onClick={() => {
                setNewChildParentId(node.id);
                setNewChildTitle("");
              }}
            >
              +
            </button>
          )}

          {canRenameHere && (
            <button
              type="button"
              className="px-1.5 py-1 text-[11px] border rounded-md bg-gray-50 hover:bg-gray-100 text-gray-700"
              title="Đổi tên mục"
              onClick={() => {
                setRenamingId(node.id);
                setRenamingTitle(node.title);
              }}
            >
              ✎
            </button>
          )}

          {canDeleteHere && (
            <button
              type="button"
              className="px-1.5 py-1 text-[11px] border rounded-md bg-red-50 hover:bg-red-100 text-red-600"
              title="Xoá mục"
              onClick={() => onDeleteNode(node.id, node.title)}
            >
              🗑
            </button>
          )}
        </div>

        {/* Form đổi tên inline */}
        {renamingId === node.id && (
          <form
            className="flex items-center gap-2 text-xs"
            onSubmit={(e) => handleSubmitRename(e, node.id)}
          >
            <input
              className={`${INPUT} h-7 text-xs`}
              value={renamingTitle}
              onChange={(e) => setRenamingTitle(e.target.value)}
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

        {/* Form thêm mục con inline */}
        {newChildParentId === node.id && (
          <form
            className="flex items-center gap-2 text-xs"
            onSubmit={(e) => handleSubmitNewChild(e, node.id)}
          >
            <input
              className={`${INPUT} h-7 text-xs`}
              placeholder="Tiêu đề mục con..."
              value={newChildTitle}
              onChange={(e) => setNewChildTitle(e.target.value)}
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
        {node.children.length > 0 && (
          <div className="space-y-1">
            {node.children.map((child) => renderNode(child))}
          </div>
        )}
      </div>
    );
  }

  if (!root) {
    return (
      <div className="text-xs text-gray-500">
        Chưa có mục con nào trong chương này.
      </div>
    );
  }

  return <div className="space-y-1">{renderNode(root)}</div>;
}
