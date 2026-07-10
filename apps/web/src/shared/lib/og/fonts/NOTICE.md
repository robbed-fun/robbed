# Bundled fonts

`IBMPlexMono-Regular.ttf` (weight 400) and `IBMPlexMono-SemiBold.ttf` (weight 600)
are the **IBM Plex Mono** typeface, distributed under the **SIL Open Font
License, Version 1.1** (https://opensource.org/license/ofl-1-1) — compatible with
this repo's MIT license. They are the TTF flavours of the woff2 files vendored for
the app UI at `src/app/fonts/IBMPlexMono-*.woff2`, converted with fonttools
(`TTFont(woff2).flavor = None; save(ttf)`) because satori cannot shape woff2.

Used only server-side by the OG-image renderer (satori via `next/og`); never
shipped to the browser. The bytes are base64-embedded in `../fonts-data.ts`
(workerd has no filesystem), so these `.ttf` files are provenance/regeneration
inputs only, not imported at runtime.
