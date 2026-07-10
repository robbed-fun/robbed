/**
 * ROBBED_ site default Open Graph share card (1200×630 PNG).
 *
 * This is the brand card that renders when someone shares `robbed.fun` itself
 * (as opposed to a specific token page, whose per-token card lives in
 * `apps/api/src/og/card.ts`). Standalone build script — NOT wired into the API;
 * its only job is to emit `og/robbed-default.png` and let a human upload it to R2.
 *
 * It REUSES the vendored native OG pipeline (`apps/api/src/og/render.ts` satori →
 * @resvg/resvg-js) and the vendored IBM Plex Mono TTFs (`apps/api/src/og/fonts/`),
 * so this card is byte-for-byte consistent with the terminal skin and the
 * per-token cards. Palette is sampled from the ROBBED_ tokens in
 * `apps/web/src/app/globals.css` / mirrored in `apps/api/src/og/theme.ts` — brand
 * color literals only, NO market metrics (spec §2).
 *
 * Docs verified via the existing pipeline's header (satori 0.19 / resvg 2.6):
 *   satori(element, { width, height, fonts }) → SVG (glyphs as <path>)
 *   new Resvg(svg, { fitTo:{mode:'width',value:1200}, font:{loadSystemFonts:false} })
 *     .render().asPng() → PNG Buffer, IHDR pinned 1200×630.
 *
 * Run:  bun tools/og/robbed-default-card.ts [outPath]
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { h } from "../../apps/api/src/og/element";
import { OG_FONTS } from "../../apps/api/src/og/fonts";
import { renderOgPng } from "../../apps/api/src/og/render";
import { OG_COLORS, OG_FONT_FAMILY, OG_HEIGHT, OG_WIDTH } from "../../apps/api/src/og/theme";

const PAD = 72;

/** The `ROBBED_` wordmark — cream letters, green cursor `_`. Ported treatment
 * from card.ts wordmark(), scaled up for the hero brand card. */
function wordmark() {
  return h(
    "div",
    {
      style: {
        display: "flex",
        alignItems: "baseline",
        fontSize: 168,
        fontWeight: 600,
        letterSpacing: "0.04em",
        lineHeight: 1,
        color: OG_COLORS.text,
      },
    },
    "ROBBED",
    h("span", { style: { color: OG_COLORS.accent } }, "_"),
  );
}

function hairline() {
  return h("div", {
    style: {
      display: "flex",
      width: "100%",
      height: 1,
      backgroundColor: OG_COLORS.border,
    },
  });
}

/** Small top eyebrow: green live dot + terminal path, mono micro-label. */
function eyebrow() {
  return h(
    "div",
    { style: { display: "flex", alignItems: "center" } },
    h("div", {
      style: {
        display: "flex",
        width: 12,
        height: 12,
        borderRadius: 6,
        backgroundColor: OG_COLORS.accent,
        marginRight: 16,
      },
    }),
    h(
      "div",
      {
        style: {
          display: "flex",
          fontSize: 22,
          letterSpacing: "0.28em",
          color: OG_COLORS.faint,
        },
      },
      "ROBBED.FUN",
    ),
  );
}

function buildCard() {
  return h(
    "div",
    {
      style: {
        width: OG_WIDTH,
        height: OG_HEIGHT,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        backgroundColor: OG_COLORS.bg,
        color: OG_COLORS.textSecondary,
        fontFamily: OG_FONT_FAMILY,
        padding: PAD,
        // Thin hairline border framing the whole card.
        border: `1px solid ${OG_COLORS.border}`,
      },
    },
    // ── Top: eyebrow ────────────────────────────────────────────────────────
    eyebrow(),
    // ── Middle: wordmark + tagline ──────────────────────────────────────────
    h(
      "div",
      { style: { display: "flex", flexDirection: "column" } },
      wordmark(),
      h(
        "div",
        {
          style: {
            display: "flex",
            marginTop: 28,
            fontSize: 40,
            fontWeight: 400,
            letterSpacing: "0.02em",
            color: OG_COLORS.muted,
          },
        },
        "rob responsibly",
        h("span", { style: { color: OG_COLORS.accent, marginLeft: 2 } }, "_"),
      ),
    ),
    // ── Bottom: hairline + accurate subtitle ────────────────────────────────
    h(
      "div",
      { style: { display: "flex", flexDirection: "column" } },
      hairline(),
      h(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            marginTop: 24,
            fontSize: 26,
            letterSpacing: "0.06em",
            color: OG_COLORS.faint,
          },
        },
        "pump.fun-style launchpad",
        h("span", { style: { color: OG_COLORS.border, margin: "0 16px" } }, "·"),
        "Robinhood Chain",
      ),
    ),
  );
}

async function main() {
  const outPath = process.argv[2] ?? join(import.meta.dir, "robbed-default.png");
  const png = await renderOgPng(buildCard(), { fonts: OG_FONTS });
  writeFileSync(outPath, png);

  // Verify PNG magic bytes + IHDR dimensions before declaring success.
  const b = png;
  const isPng =
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a;
  const width = (b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19];
  const height = (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23];
  console.log(`wrote ${outPath}`);
  console.log(`bytes=${b.byteLength} png=${isPng} IHDR=${width}x${height}`);
  if (!isPng || width !== OG_WIDTH || height !== OG_HEIGHT) {
    console.error("FAIL: not a valid 1200x630 PNG");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
