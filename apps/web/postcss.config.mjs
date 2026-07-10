/**
 * Tailwind CSS v4 PostCSS pipeline (docs: tailwindcss.com/docs, verified
 * 2026-07-10). v4 ships its own PostCSS plugin; no `autoprefixer`/`postcss-import`
 * needed — the engine handles both. All theme tokens live in app/globals.css
 * `@theme` (web.md §7 / spec §12.24).
 */
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
