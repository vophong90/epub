
import type { Config } from "tailwindcss";
export default {
  content: ["./app/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        serif: ["Times New Roman", "serif"]
      },
      colors: {
        brand: "#0b7a3b"
      }
    }
  },
  plugins: []
} satisfies Config;
