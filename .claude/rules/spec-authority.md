# Authority chain & docs-first (always loaded)

- Source of truth: `docs/spec.md` (v1.2). When code and spec disagree, the spec wins. When the spec is silent or self-contradictory, never self-resolve: ask, or record the decision in spec §12 (numbered, dated) / the open item in §13 with an owner.
- Docs precede code: every change traces to a `docs/developers/*.md` design section (or a spec §). New behavior → update the design doc first (same PR is fine; the doc diff must stand on its own).
- Docs-first for libraries: consult current official docs via the context7 MCP (`resolve-library-id` → `query-docs`) before touching any library/tool — never code from memory; WebFetch of canonical docs is the fallback. Docs beat assumptions; the spec beats docs (flag the conflict).
- Contributor process (PR flow, test tiers, validate.sh, Conventional Commits enforced by `.githooks/commit-msg`): `docs/CONTRIBUTING.md`.
