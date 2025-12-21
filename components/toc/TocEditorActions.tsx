// components/toc/TocEditorActions.tsx
"use client";

import { BTN_SM, BTN_SM_PRIMARY } from "./tocButtonStyles";

type TocEditorActionsProps = {
  canApprove: boolean;
  canRequestChange: boolean;
  approving: boolean;
  requestingChange: boolean;
  onApprove: () => void;
  onRequestChange: () => void;
};

export function TocEditorActions({
  canApprove,
  canRequestChange,
  approving,
  requestingChange,
  onApprove,
  onRequestChange,
}: TocEditorActionsProps) {
  return (
    <section className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
      <h3 className="font-semibold text-sm text-slate-800">
        Hành động của Editor (cho cả chương)
      </h3>
      <p className="text-xs text-slate-600">
        Chỉ editor mới thấy phần này. Bạn có thể duyệt hoặc yêu cầu tác giả
        chỉnh sửa khi trạng thái chương đang là <strong>Đã nộp</strong>.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <button
          className={BTN_SM_PRIMARY}
          onClick={onApprove}
          disabled={!canApprove || approving}
        >
          {approving ? "Đang duyệt..." : "Duyệt chương"}
        </button>

        <button
          className={BTN_SM}
          onClick={onRequestChange}
          disabled={!canRequestChange || requestingChange}
        >
          {requestingChange ? "Đang gửi yêu cầu..." : "Yêu cầu chỉnh sửa chương"}
        </button>
      </div>
    </section>
  );
}
