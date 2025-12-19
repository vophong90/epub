// app/books/[id]/page.tsx

type BookPageProps = {
  params: {
    id: string;
  };
};

export default function BookPage({ params }: BookPageProps) {
  return (
    <main style={{ padding: 40 }}>
      <h1>BOOK-DEBUG-PAGE</h1>
      <p>ID: {params.id}</p>
    </main>
  );
}
