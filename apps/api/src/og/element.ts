/**
 * Tiny hyperscript helper for building the satori element tree WITHOUT JSX/React.
 *
 * DECISION (own it — implementation approach, api.md "decide-it-yourself"): the
 * API is a plain Bun/Hono TS service with no JSX toolchain and no React runtime
 * dependency. satori accepts any React-like node — it reads only `element.type`
 * and `element.props` (incl. `props.children`); it never checks React's
 * `$$typeof` symbol — so a plain `{ type, props }` object renders identically to a
 * JSX element. Building the card with `h()` lets us port the frontend's
 * `token-og-card.tsx` layout 1:1 while keeping the API free of `react` +
 * `@types/react` + a `jsx` tsconfig. (Verified against satori 0.19 docs: element
 * is a "JSX element"/ReactNode read structurally.)
 */

export type Style = Record<string, string | number | undefined>;

export interface OgElement {
  type: string;
  props: {
    style?: Style;
    children?: OgChild | OgChild[];
    [key: string]: unknown;
  };
}

export type OgChild = OgElement | string | number | null | undefined | false;

export function h(
  type: string,
  props: { style?: Style; [key: string]: unknown } | null,
  ...children: OgChild[]
): OgElement {
  const flat = children.flat().filter((c) => c !== null && c !== undefined && c !== false);
  return {
    type,
    props: {
      ...(props ?? {}),
      // satori reads a single child or an array; collapse to match React shape.
      children: flat.length === 0 ? undefined : flat.length === 1 ? flat[0] : flat,
    },
  };
}
