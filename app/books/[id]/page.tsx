export default function BookDebugPage({ params }: { params: { id: string } }) {
  return (
    <main style={{ padding: 40 }}>
      <h1>BOOK-DEBUG-PAGE</h1>
      <p>ID: {params.id}</p>
    </main>
  );
}
