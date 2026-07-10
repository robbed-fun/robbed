# Vendored fonts — IBM Plex Mono

`IBMPlexMono-{Regular,Medium,SemiBold}.woff2` (weights 400/500/600, latin subset)
are vendored from the [Fontsource](https://fontsource.org/fonts/ibm-plex-mono)
distribution of **IBM Plex Mono** (© IBM Corp.), licensed under the
[SIL Open Font License 1.1](https://github.com/IBM/plex/blob/master/LICENSE.txt).

Why vendored (decision, hoodpad-frontend, ROBBED_ redesign Phase F):

- The `ROBBED_` terminal design (`docs/Robbed.html`) renders everything in
  IBM Plex Mono — sampled from the mockup's computed styles, not assumed.
- `next/font/local` self-hosts these files (nextjs.org/docs/app/getting-started/fonts,
  verified 2026-07-10): zero runtime fetches to any third-party origin (CSP-safe),
  no layout shift, deterministic offline/CI builds — unlike `next/font/google`,
  which needs a build-time network fetch.
