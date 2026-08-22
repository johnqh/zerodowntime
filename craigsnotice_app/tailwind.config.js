/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
    "./node_modules/@sudobility/components/dist/**/*.{js,mjs,cjs}",
  ],
  theme: {
    extend: {
      // Vintage: mid-century catalogue print. Aged paper, sepia ink, oxblood
      // and mustard accents, serif throughout, double rules and small caps.
      fontFamily: {
        serif: [
          "Georgia",
          "Iowan Old Style",
          "Palatino Linotype",
          "Book Antiqua",
          "Times New Roman",
          "serif",
        ],
        display: ["Georgia", "Iowan Old Style", "Palatino Linotype", "serif"],
        sans: ["Georgia", "Palatino Linotype", "serif"],
      },
      colors: {
        paper: {
          DEFAULT: "#F7F1E3", // aged stock
          deep: "#EFE6D2", // panel
          edge: "#E2D6BC", // rule tint
        },
        ink: {
          DEFAULT: "#2E2418", // sepia black
          muted: "#6B5B45",
          faint: "#9A8A73",
        },
        rule: "#5C4B33",
        accent: {
          DEFAULT: "#8C2F2F", // oxblood
          soft: "#F0DFD8",
        },
        brass: "#B58A38", // mustard / gilt
      },
      letterSpacing: {
        caps: "0.14em",
        title: "0.01em",
      },
      borderRadius: {
        DEFAULT: "2px",
      },
      fontSize: {
        display: ["3.25rem", { lineHeight: "1.05", letterSpacing: "0.01em" }],
        title: ["1.875rem", { lineHeight: "1.15" }],
        lede: ["1.1875rem", { lineHeight: "1.6" }],
        micro: ["0.6875rem", { lineHeight: "1.3", letterSpacing: "0.14em" }],
      },
      boxShadow: {
        card: "0 1px 0 0 #E2D6BC, 0 2px 6px -4px rgba(46,36,24,0.35)",
      },
    },
  },
  plugins: [],
};
