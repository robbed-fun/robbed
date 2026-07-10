# ROBBED_ — Documentation Index

Reading order for anyone (human or agent) new to the project:

| # | Document | What it is |
|---|---|---|
| 1 | [`../launchpad-spec.md`](../launchpad-spec.md) | **Root authority.** Product + system spec v1.1. §12 = resolved decisions, §13 = open items. Everything else derives from this. |
| 2 | [`../CLAUDE.md`](../CLAUDE.md) | Distilled hard rules, chain facts, stack, gates. Read alongside the spec at the start of every task. |
| 3 | [`architecture.md`](architecture.md) | System overview: context diagram, service summaries, end-to-end flows (launch / trade / graduation / fee collection), cross-service contract ownership, confirmation semantics, infra, milestone map. |
| 4 | [`development-flow.md`](development-flow.md) | The spec-driven process: authority chain, docs-precede-code, ambiguity protocol, agent roster and path ownership, iteration loop, cross-service ratification, `/spec-check` + security gates. |
| 5 | [`decisions.md`](decisions.md) | Consolidated register of every flagged open item / interpretation (contracts O-*, indexer OI-*, api OI-A*, web 1–11) with disposition, rationale, and spec cross-references. |
| 6 | [`services/contracts.md`](services/contracts.md) | Contract-layer design (M1): six contracts, canonical event ABIs, flows, economics/constants contract with M0, guards, gates 1–4 test obligations, deploy order. |
| 7 | [`services/indexer.md`](services/indexer.md) | Indexer design (M2): six event families, Postgres schema, venue-continuous candles, confirmation pipeline, metadata verification, Redis→WS contract. |
| 8 | [`services/api.md`](services/api.md) | API + WS design (M2): endpoint inventory (`/v1/...`), upload/metadata pipeline, search, moderation, `packages/shared` module ownership, auth/rate limits. |
| 9 | [`services/web.md`](services/web.md) | Frontend design (M3): three pages, Trust panel, optimistic/confirmation UX, copy rules, OG images, design system, e2e matrix. |
| 10 | [`implementation-plan.md`](implementation-plan.md) | Master meta-plan: goal end-state checklist ("production-ready, not production-launched"), phased checkbox items with owners + verification commands. Driven by the `/goal` command. |

Ground rules: the spec wins over every doc here; each `services/*.md` is authoritative for its own service's interfaces and internals; `architecture.md` and `decisions.md` are derived views that get fixed if they drift. Process for changing any of this: [`development-flow.md`](development-flow.md).
