export default function Home() {
  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">EPUB</h1>
      <p className="text-gray-700 mb-4">
        Thư viện sách/chuyên đề – Khoa Y học cổ truyền
      </p>
      <a
        href="/books"
        className="inline-flex items-center px-4 py-2 rounded-lg bg-brand text-white font-semibold"
      >
        Vào My Books
      </a>
      <a href="/login" className="ml-3 underline text-brand">
        Đăng nhập
      </a>
    </div>
  );
}
