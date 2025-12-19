// app/books/[id]/page.tsx
"use client";

import { useParams } from "next/navigation";

export default function BookDebugPage() {
  const params = useParams();

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 24, fontWeight: "bold", marginBottom: 16 }}>
        DEBUG /books/[id]
      </h1>
      <p>Route động đang hoạt động.</p>
      <pre
        style={{
          marginTop: 16,
          padding: 12,
          borderRadius: 8,
          border: "1px solid #ddd",
          background: "#f9fafb",
          fontFamily: "monospace",
          fontSize: 13,
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
        }}
      >
        {JSON.stringify(params, null, 2)}
      </pre>
    </div>
  );
}
