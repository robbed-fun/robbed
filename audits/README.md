# Audits & Security Reviews

Index of every security review of ROBBED_ — internal adversarial reviews and (future) external audits. Each entry is published as-delivered with a full findings register and dispositions; findings are never silently dropped or rewritten after the fact.

For the protocol's normative security properties and the 10-gate program these reviews feed, see [docs/security-properties.md](../docs/security-properties.md). To report a vulnerability, see [SECURITY.md](../SECURITY.md).

| Date | Commit | Reviewer | Type | Scope | Report |
|---|---|---|---|---|---|
| 2026-07-10 | `f83967a` | robbed-security (internal) | Adversarial review — M1 close-out (gate 5-style multi-pass; verdict: 0 open High+) | `contracts/src/**` (6 contracts + CurveMath + errors + interfaces) | [2026-07-10_internal-adversarial-review_M1.md](2026-07-10_internal-adversarial-review_M1.md) |

**No external firm audit has been performed yet.** The caps-lift decision gate (spec §10, gate 9) explicitly reconsiders commissioning one; this table will be updated when it happens.
