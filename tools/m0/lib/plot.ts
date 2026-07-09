/**
 * lib/plot.ts — dependency-free SVG line plots (price / mcap vs tokens sold)
 * plus a markdown checkpoint table. No plotting library needed (m0-notebook
 * allows ASCII/SVG); SVGs are self-contained and viewable in any browser.
 */

export interface Series {
  x: number[];
  y: number[];
}

export interface PlotOpts {
  title: string;
  subtitle?: string;
  xLabel: string;
  yLabel: string;
  /** index into the series to mark as the graduation point */
  markIndex?: number;
  markLabel?: string;
}

const W = 860;
const H = 480;
const M = { top: 64, right: 40, bottom: 64, left: 90 };

function niceTicks(min: number, max: number, count = 6): number[] {
  const span = max - min || 1;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? mag * 10;
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-12; v += step) ticks.push(v);
  return ticks;
}

const fmt = (v: number): string => {
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toPrecision(3)}B`;
  if (a >= 1e6) return `${(v / 1e6).toPrecision(3)}M`;
  if (a >= 1e3) return `${(v / 1e3).toPrecision(3)}k`;
  if (a < 0.01) return v.toExponential(2);
  return v.toPrecision(3);
};

export function linePlotSvg(s: Series, o: PlotOpts): string {
  const xMin = Math.min(...s.x);
  const xMax = Math.max(...s.x);
  const yMin = 0;
  const yMax = Math.max(...s.y) * 1.06;
  const px = (x: number) => M.left + ((x - xMin) / (xMax - xMin || 1)) * (W - M.left - M.right);
  const py = (y: number) => H - M.bottom - ((y - yMin) / (yMax - yMin || 1)) * (H - M.top - M.bottom);

  const path = s.x.map((x, i) => `${i === 0 ? "M" : "L"}${px(x).toFixed(1)},${py(s.y[i]!).toFixed(1)}`).join(" ");

  const xt = niceTicks(xMin, xMax)
    .map(
      (v) =>
        `<line x1="${px(v)}" y1="${H - M.bottom}" x2="${px(v)}" y2="${H - M.bottom + 6}" stroke="#888"/>` +
        `<text x="${px(v)}" y="${H - M.bottom + 22}" text-anchor="middle" class="t">${fmt(v)}</text>`,
    )
    .join("");
  const yt = niceTicks(yMin, yMax)
    .map(
      (v) =>
        `<line x1="${M.left}" y1="${py(v)}" x2="${W - M.right}" y2="${py(v)}" stroke="#e5e5e5"/>` +
        `<text x="${M.left - 10}" y="${py(v) + 4}" text-anchor="end" class="t">${fmt(v)}</text>`,
    )
    .join("");

  let mark = "";
  if (o.markIndex !== undefined) {
    const mx = px(s.x[o.markIndex]!);
    const my = py(s.y[o.markIndex]!);
    mark =
      `<circle cx="${mx}" cy="${my}" r="6" fill="#d33" stroke="#fff" stroke-width="2"/>` +
      `<text x="${mx - 10}" y="${my - 12}" text-anchor="end" class="t" fill="#d33" font-weight="bold">${o.markLabel ?? "graduation"}</text>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<style>.t{font:12px ui-monospace,monospace;fill:#444}.title{font:bold 16px ui-sans-serif,sans-serif;fill:#111}.sub{font:12px ui-sans-serif,sans-serif;fill:#666}.lbl{font:13px ui-sans-serif,sans-serif;fill:#333}</style>
<rect width="${W}" height="${H}" fill="#fff"/>
<text x="${M.left}" y="26" class="title">${o.title}</text>
${o.subtitle ? `<text x="${M.left}" y="46" class="sub">${o.subtitle}</text>` : ""}
${yt}${xt}
<line x1="${M.left}" y1="${H - M.bottom}" x2="${W - M.right}" y2="${H - M.bottom}" stroke="#888"/>
<line x1="${M.left}" y1="${M.top}" x2="${M.left}" y2="${H - M.bottom}" stroke="#888"/>
<path d="${path}" fill="none" stroke="#2563eb" stroke-width="2.5"/>
${mark}
<text x="${(M.left + W - M.right) / 2}" y="${H - 18}" text-anchor="middle" class="lbl">${o.xLabel}</text>
<text x="20" y="${(M.top + H - M.bottom) / 2}" text-anchor="middle" class="lbl" transform="rotate(-90 20 ${(M.top + H - M.bottom) / 2})">${o.yLabel}</text>
</svg>
`;
}

export function markdownTable(headers: string[], rows: string[][]): string {
  const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
  return [line(headers), line(headers.map(() => "---")), ...rows.map(line)].join("\n") + "\n";
}
