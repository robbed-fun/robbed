# Authority chain & docs-first (always loaded)

- Source of truth: `README.md` + the developer docs under `docs/developers/**` (and the user docs under `docs/users/**`). When code and docs disagree, the docs win. When the docs are silent or self-contradictory, never self-resolve: ask, or record the decision (numbered, dated, with an owner for anything left open) in the design decisions log in `docs/developers/`.
- Docs precede code: every change traces to a design section under `docs/developers/**`. New behavior → update the design doc first (same PR is fine; the doc diff must stand on its own).
- Docs-first for libraries: consult current official docs via the context7 MCP (`resolve-library-id` → `query-docs`) before touching any library/tool — never code from memory; WebFetch of canonical docs is the fallback. External docs beat assumptions; the project's design docs beat external library docs (flag the conflict).
- Contributor process (PR flow, test tiers, validate.sh, Conventional Commits enforced by `.githooks/commit-msg`): `docs/CONTRIBUTING.md`.
