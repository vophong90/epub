// app/page.tsx
"use client";

import Link from "next/link";
import Image from "next/image";
import { useMemo, useState } from "react";
import { useAuth } from "@/components/AuthProvider";

type AboutKey = "mission" | "vision" | "values" | "philosophy";

const ABOUT: Record<
  AboutKey,
  {
    title: string;
    text: string;
    colors: { from: string; to: string; border: string; accent: string; text: string };
  }
> = {
  mission: {
    title: "Sứ mạng",
    text:
      "Đào tạo nguồn nhân lực y tế chất lượng cao và chuyên gia hàng đầu dẫn dắt, lãnh đạo trong lĩnh vực y dược cổ truyền kết hợp y dược hiện đại; Kế thừa, phát triển tinh hoa y dược cổ truyền, đóng góp vào thành tựu khoa học, tri thức nhân loại; Phát triển tinh thần phụng sự cộng đồng.",
    colors: { from: "#EEF7FF", to: "#FFFFFF", border: "#BADBFF", accent: "#0E7BD0", text: "#0b253a" },
  },
  vision: {
    title: "Tầm nhìn",
    text:
      "Trở thành cơ sở giáo dục hàng đầu Việt Nam về lĩnh vực y dược cổ truyền với chương trình đào tạo đạt chuẩn quốc tế và đáp ứng nhu cầu xã hội.",
    colors: { from: "#EFFAF3", to: "#FFFFFF", border: "#B5E6C9", accent: "#228C5C", text: "#0c3326" },
  },
  values: {
    title: "Giá trị cốt lõi",
    text: "Chuyên nghiệp – Kế thừa – Sáng tạo – Hội nhập – Nhân văn",
    colors: { from: "#FFFAE8", to: "#FFFFFF", border: "#FFE58A", accent: "#F59F00", text: "#4a3000" },
  },
  philosophy: {
    title: "Triết lý giáo dục",
    text:
      "Phát huy nội lực và tăng cường hợp tác quốc tế nhằm tối ưu môi trường dạy và học, lấy người học làm trung tâm, xây dựng đội ngũ cán bộ y tế toàn diện, có đức có tài, có trách nhiệm, sẵn sàng thích ứng và hội nhập.",
    colors: { from: "#EEF6FF", to: "#FFFFFF", border: "#8EC4FF", accent: "#0E7BD0", text: "#0a274b" },
  },
};

type CardItem = {
  href?: string;
  title: string;
  desc: string;
  icon: string;
  iconBg: string;
  bg: string;
  ring: string;
  badgeBorder: string;
  badgeText: string;
  disabled?: boolean;
  rightBadge?: string;
};

export default function HomePage() {
  const { user, profile, loading } = useAuth();
  const [active, setActive] = useState<AboutKey>("mission");
  const panel = ABOUT[active];

  const displayName =
    profile?.name?.trim() ||
    profile?.email?.split("@")[0] ||
    user?.email?.split("@")[0] ||
    null;

  const CARD_ITEMS: CardItem[] = useMemo(() => {
    const items: CardItem[] = [
      {
        href: "/books",
        title: "Biên tập",
        desc: "Quản lý sách/chuyên đề, phân quyền, mở sách để chỉnh sửa",
        icon: "📚",
        iconBg: "linear-gradient(135deg,#E6F2FF,#FFFFFF)",
        bg: "radial-gradient(600px 300px at -10% -20%, rgba(14,123,208,.08), transparent 50%), linear-gradient(180deg,#ffffff, #f7fbff)",
        ring: "#90CAF9",
        badgeBorder: "#90CAF9",
        badgeText: "#0E7BD0",
        rightBadge: "My Books",
      },
      {
        title: "Biên soạn",
        desc: "Chưa triển khai (sẽ bổ sung sau)",
        icon: "✍️",
        iconBg: "linear-gradient(135deg,#E8F8EF,#FFFFFF)",
        bg: "radial-gradient(600px 300px at 110% -20%, rgba(43,174,114,.10), transparent 50%), linear-gradient(180deg,#ffffff,#f6fdf9)",
        ring: "#A5D6A7",
        badgeBorder: "#81C784",
        badgeText: "#2BAE72",
        disabled: true,
        rightBadge: "Sắp có",
      },
      {
        title: "Xuất bản",
        desc: "Chưa triển khai (sẽ bổ sung sau)",
        icon: "🚀",
        iconBg: "linear-gradient(135deg,#FFF4E0,#FFFFFF)",
        bg: "radial-gradient(600px 300px at -10% -20%, rgba(245,159,0,.10), transparent 50%), linear-gradient(180deg,#ffffff,#fffaf0)",
        ring: "#FFCC80",
        badgeBorder: "#FFB74D",
        badgeText: "#F59F00",
        disabled: true,
        rightBadge: "Sắp có",
      },
    ];

    // Card đăng nhập / user
    if (!loading && !user) {
      items.push({
        href: "/login",
        title: "Đăng nhập",
        desc: "Truy cập đầy đủ các chức năng theo vai trò",
        icon: "🔐",
        iconBg: "linear-gradient(135deg,#EEF7FF,#FFFFFF)",
        bg: "radial-gradient(600px 300px at 110% -20%, rgba(14,123,208,.08), transparent 50%), linear-gradient(180deg,#ffffff,#f6faff)",
        ring: "#90CAF9",
        badgeBorder: "#90CAF9",
        badgeText: "#0E7BD0",
        rightBadge: "Login",
      });
    } else if (!loading && user) {
      items.push({
        href: "/books",
        title: displayName ? `Xin chào, ${displayName}` : "Tài khoản",
        desc: "Vào My Books để biên tập sách/chuyên đề",
        icon: "👤",
        iconBg: "linear-gradient(135deg,#F2F2F2,#FFFFFF)",
        bg: "radial-gradient(600px 300px at 110% -20%, rgba(0,0,0,.06), transparent 50%), linear-gradient(180deg,#ffffff,#f8f9fb)",
        ring: "#B0BEC5",
        badgeBorder: "#B0BEC5",
        badgeText: "#37474F",
        rightBadge: "Tài khoản",
      });
    }

    return items;
  }, [user, profile, loading, displayName]);

  return (
    <div className="bg-white text-gray-900">
      {/* HERO */}
      <section
        className="relative"
        style={{
          background:
            "radial-gradient(1200px 600px at -10% -20%, rgba(14,123,208,.20), transparent 60%), radial-gradient(1200px 600px at 110% -10%, rgba(43,174,114,.18), transparent 60%), linear-gradient(180deg, #ffffff 0%, #edf2f7 100%)",
        }}
      >
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-12 md:py-16">
          <div className="grid lg:grid-cols-2 gap-10 items-start">
            {/* Trái */}
            <div className="space-y-6">
              <div className="flex items-center gap-4">
                <div className="w-20 h-20 rounded-full bg-white border border-black/10 shadow-md grid place-items-center overflow-hidden">
                  <Image
                    src="/assets/brand/logo-ump.png"
                    alt="ĐẠI HỌC Y DƯỢC TPHCM"
                    width={72}
                    height={72}
                    className="object-contain"
                  />
                </div>
                <div className="w-20 h-20 rounded-full bg-white border border-black/10 shadow-md grid place-items-center overflow-hidden">
                  <Image
                    src="/assets/brand/logo-yhct.png"
                    alt="KHOA Y HỌC CỔ TRUYỀN"
                    width={72}
                    height={72}
                    className="object-contain"
                  />
                </div>
              </div>

              <h1 className="text-3xl md:text-4xl font-bold leading-tight">
                KHOA Y HỌC CỔ TRUYỀN
                <br />
                <span className="text-[#0E7BD0] text-[0.9em] font-semibold tracking-tight whitespace-nowrap">
                  ĐẠI HỌC Y DƯỢC THÀNH PHỐ HỒ CHÍ MINH
                </span>
              </h1>

              <p className="text-gray-800 md:text-lg">
                Nền tảng biên tập, xuất bản tài liệu số về giáo dục, đào tạo, cập nhật kiến thức y khoa liên tục.
              </p>

              <div className="flex flex-wrap gap-3">
                <Link
                  className="inline-flex items-center justify-center rounded-lg px-4 py-2 font-bold gap-2 bg-[#0E7BD0] text-white hover:bg-[#0b65aa] shadow ring-1 ring-black/5"
                  href="/books"
                >
                  Vào My Books
                </Link>

                {!loading && !user ? (
                  <Link className="inline-flex items-center justify-center rounded-lg px-4 py-2 font-bold gap-2 border bg-white hover:bg-gray-50" href="/login">
                    Đăng nhập
                  </Link>
                ) : (
                  <span className="inline-flex items-center justify-center rounded-lg px-4 py-2 font-bold gap-2 border bg-white text-slate-700">
                    {displayName ? `Xin chào, ${displayName}` : "Đã đăng nhập"}
                  </span>
                )}
              </div>
            </div>

            {/* Phải: 4 medallions + panel nội dung */}
            <div className="space-y-6">
              {/* Lưới vòng tròn */}
              <div className="grid grid-cols-2 gap-4 justify-items-center">
                {(["mission", "vision", "values", "philosophy"] as AboutKey[]).map((k) => (
                  <button
                    key={k}
                    onClick={() => setActive(k)}
                    aria-pressed={active === k}
                    className={[
                      "w-40 h-40 md:w-44 md:h-44 rounded-full flex flex-col items-center justify-center text-center p-4 font-medium transition outline outline-2 outline-offset-4",
                      "shadow-[0_12px_28px_rgba(0,0,0,.12),_inset_0_1px_0_rgba(255,255,255,.35)]",
                      active === k ? "translate-y-[-2px] scale-[1.03]" : "hover:translate-y-[-2px] hover:scale-[1.02]",
                      k === "mission"
                        ? "text-[#073b78]"
                        : k === "vision"
                        ? "text-[#0e3a28]"
                        : k === "values"
                        ? "text-[#5b3600]"
                        : "text-[#082e5e]",
                    ].join(" ")}
                    style={
                      k === "mission"
                        ? {
                            backgroundImage:
                              "radial-gradient(120px 90px at 30% 30%, rgba(255,255,255,.9), rgba(238,247,255,.95)), linear-gradient(135deg,#BADBFF 0%,#5AA9F7 60%,#2D8FE8 100%)",
                          }
                        : k === "vision"
                        ? {
                            backgroundImage:
                              "radial-gradient(120px 90px at 30% 30%, rgba(255,255,255,.9), rgba(239,250,243,.95)), linear-gradient(135deg,#B5E6C9 0%, #53C48B 60%, #2BAE72 100%)",
                          }
                        : k === "values"
                        ? {
                            backgroundImage:
                              "radial-gradient(120px 90px at 30% 30%, rgba(255,255,255,.92), rgba(255,250,232,.96)), linear-gradient(135deg,#FFE58A 0%, #FFC21E 60%, #FFB000 100%)",
                          }
                        : {
                            backgroundImage:
                              "radial-gradient(120px 90px at 30% 30%, rgba(255,255,255,.9), rgba(237,246,255,.95)), linear-gradient(135deg,#8EC4FF 0%, #2D8FE8 60%, #0E7BD0 100%)",
                          }
                    }
                  >
                    <small className="block font-bold tracking-widest uppercase text-[0.7rem] opacity-90">
                      {ABOUT[k].title}
                    </small>
                    <span className="block font-semibold mt-1">
                      {k === "mission" && "Mission"}
                      {k === "vision" && "Vision"}
                      {k === "values" && "Core Values"}
                      {k === "philosophy" && "Philosophy"}
                    </span>
                  </button>
                ))}
              </div>

              {/* Panel nội dung */}
              <article
                className="relative rounded-xl p-5 shadow-[0_18px_48px_rgba(14,123,208,.15)] overflow-hidden border"
                style={{
                  background: `linear-gradient(135deg, ${panel.colors.from}, ${panel.colors.to})`,
                  borderColor: panel.colors.border,
                  color: panel.colors.text,
                }}
              >
                <div className="absolute left-0 top-0 bottom-0 w-1.5 opacity-90" style={{ background: panel.colors.accent }} />
                <h3 className="text-sm uppercase tracking-wider font-extrabold">{panel.title}</h3>
                <p className="mt-2 leading-7 text-[.95rem]">{panel.text}</p>
                <div
                  className="pointer-events-none absolute inset-0"
                  style={{
                    background: "radial-gradient(400px 220px at -10% 0%, rgba(255,255,255,.55), transparent 40%)",
                  }}
                />
              </article>
            </div>
          </div>
        </div>
      </section>

      {/* QUICK LINKS */}
      <main className="max-w-6xl mx-auto px-4 md:px-6 py-10 space-y-10">
        <section>
          <h2 className="text-xl font-semibold mb-5">Chức năng nhanh</h2>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
            {CARD_ITEMS.map((it) => {
              const CardInner = (
                <>
                  <div aria-hidden className="absolute inset-0 opacity-[.9] transition-opacity" style={{ background: it.bg }} />
                  <div
                    className="absolute -inset-1 rounded-2xl opacity-0 group-hover:opacity-100 transition ring-1 ring-[var(--ring)]"
                    style={{ ["--ring" as any]: it.ring }}
                  />
                  <div className="relative p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-xl grid place-items-center shadow ring-1 ring-black/5" style={{ background: it.iconBg }}>
                          <span className="text-xl">{it.icon}</span>
                        </div>
                        <h3 className="font-semibold text-gray-900">{it.title}</h3>
                      </div>
                      <span
                        className="rounded-full text-xs px-2 py-1 border bg-white/70 backdrop-blur group-hover:bg-white transition"
                        style={{ borderColor: it.badgeBorder, color: it.badgeText }}
                      >
                        {it.rightBadge ?? "Đi tới"}
                      </span>
                    </div>
                    <p className="text-sm text-gray-700 mt-2">{it.desc}</p>

                    {!it.disabled && (
                      <div className="mt-4 text-sm font-medium text-[#0E7BD0] opacity-0 group-hover:opacity-100 translate-y-1 group-hover:translate-y-0 transition">
                        Mở ngay →
                      </div>
                    )}
                  </div>
                </>
              );

              if (it.disabled || !it.href) {
                return (
                  <div
                    key={it.title}
                    className="group relative rounded-2xl overflow-hidden border border-gray-200 bg-white shadow-sm opacity-80"
                  >
                    {CardInner}
                    <div className="absolute inset-0 pointer-events-none bg-white/40" />
                  </div>
                );
              }

              return (
                <Link
                  key={it.href}
                  href={it.href}
                  className="group relative rounded-2xl overflow-hidden border border-gray-200 bg-white shadow-sm hover:shadow-xl transition-all duration-300"
                >
                  {CardInner}
                </Link>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}
