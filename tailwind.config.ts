import type { Config } from "tailwindcss";

export default {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    // nếu anh có thư mục lib/ui khác thì thêm tiếp ở đây
  ],
  theme: {
    extend: {
      fontFamily: {
        serif: ["Times New Roman", "serif"],
      },
      colors: {
        brand: "#0b7a3b",
      },
    },
  },
  plugins: [],
} satisfies Config;
