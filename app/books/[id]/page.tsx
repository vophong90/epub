// app/books/[id]/page.tsx
// @ts-nocheck    <- TẮT TS CHO CẢ FILE NÀY

export default function BookPage({ params }: any) {
  return (
    <main style={{ padding: 40 }}>
      <h1>BOOK-DEBUG-PAGE</h1>
      <p>ID: {params?.id}</p>
    </main>
  );
}
