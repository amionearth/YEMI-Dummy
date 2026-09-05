module.exports = {
  content: ["./src/renderer/**/*.{ts,tsx,html}"],
  theme: {
    extend: {
      colors: {
        navy: "#102149",
        slatecopy: "#63708f",
        brand: { DEFAULT: "#176df2", light: "#3b96ff" },
      },
      fontFamily: {
        monoDisplay: ['"SFMono-Regular"', '"Cascadia Code"', '"Roboto Mono"', "monospace"],
      },
      boxShadow: {
        glass: "0 24px 70px rgba(50, 104, 180, 0.18)",
      },
    },
  },
};
