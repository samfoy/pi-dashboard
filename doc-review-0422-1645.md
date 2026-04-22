# Adversarial Review: ARCADE 2.0 — Every Defect Has an Owner

**Reviewed:** https://quip-amazon.com/a8cVAK8aEwpV/ARCADE-20-Every-Defect-Has-an-Owner
**Date:** 2026-04-22
**Personas:** sukhpal, premortem, antagonist, naive, ops

---

## Executive Summary

The problem diagnosis is sharp and honest — the 65% unresolved defect rate, the absent learning loop, and the structural cause ("CS detects but doesn't own resolution") are well-articulated. The strategic pivot from "platform" to "accountability + verified outcomes" is the right instinct, and the disposable-vs-durable component layering is sound architecture thinking.

**Top 3 issues:** (1) The doc proposes mandatory tracking without addressing who grants the organizational authority to make it mandatory — the Shepherd analogy papers over the hardest problem. (2) Six components across three layers with zero execution plan — no staffing, sequencing, cost, or timeline. (3) Key terms (ARCADE, defect, CS) are never defined, and the central business number (365M entitlement) has no derivation.

The doc reads as a compelling strategy narrative but leaves readers unable to assess feasibility, evaluate risk, or begin implementation.

---

## 🔴 Blocking Issues

### 1. §The Idea — "Mandatory" without a mandate: who grants Steward enforcement authority?
`sukhpal` `premortem` `antagonist` `ops`

> "Build Steward, a system that does for defects what Shepherd does for security vulnerabilities."

Shepherd works because Security has executive-level authority to enforce SLAs on any team, backed by legal/compliance forcing functions. CS has no such authority over defect owners. The doc correctly identifies the structural problem ("An owner can close the ticket without fixing anything, and no system notices") then proposes a software system as the solution to what is fundamentally an organizational authority problem. Who signs the S-Team memo? What happens when an owner org's VP says "we have higher priorities"?

The pre-mortem persona's most likely headline: **"Steward was a well-designed system that nobody was forced to use."** The ops persona adds: you can't make something mandatory without a plan for when it's wrong or unavailable.

**Fix:** Add a section on the organizational mechanism — who grants mandatory authority, what level of leadership sponsorship exists or is needed, and what the enforcement model looks like (soft launch → pilot → VP mandate vs. day-one mandatory). Address the political reality that scorecards are zero-sum: one team's "200 open P1 defects" is that team's "CS is dumping unvalidated work on our backlog."

---

### 2. §What We Build — Six components, zero execution plan
`sukhpal` `premortem` `antagonist`

> "Six components in three layers — the mandate (Steward, Campaign Framework), the intelligence (Identity Graph, Verification Engine, Defect Intelligence Layer), and the execution (Use-Case Agents) — from most durable to most disposable."

No team size, no staffing, no build order, no critical path, no cost, no dependencies, no timeline. The doc proposes building all six on top of a 2026 roadmap already in flight. How many engineers? What gets deprioritized? What ships first? The Defect Intelligence Layer depends on Verification Engine, which depends on Steward adoption, which depends on organizational mandate — a three-deep unproven dependency chain. A reader cannot assess feasibility.

**Fix:** Add a Phasing section: what's P0 (must ship first), what's P1, what can wait. Name the critical path. State the team size assumption. If this is a vision doc and not a plan, state that explicitly — but then scope what IS the plan. Add a sentence on 2026 roadmap status (on track?) since the proposal builds on it.

---

### 3. §The Opportunity — "365 million defect reductions" entitlement has no derivation
`sukhpal` `antagonist` `naive`

> "Amazon's entitlement is 365 million defect reductions per year. Amazon realizes roughly a quarter of that."

This is the central business justification. The doc says 86M detected defects and 5M unique after dedup — neither maps to 365M. No methodology, no link, no citation. Is "entitlement" a ceiling, forecast, or goal? What does "defect reduction" mean concretely? If this number is wrong, the gap narrative collapses.

**Fix:** Add a footnote or appendix with the methodology. State what "defect reduction" means (unique defects fixed? customer contacts prevented?). Link to the analysis.

---

### 4. §Throughout — Key terms never defined: ARCADE, defect, CS
`sukhpal` `naive`

"ARCADE" appears as a system ("ARCADE ingests"), a platform ("we stop pitching ARCADE as a platform"), and a team ("ARCADE becomes the team"). "Defect" is used 40+ times but never defined — in standard SWE it means a software bug, here it seems to mean a customer-impacting issue. "CS" is never expanded. "Owner teams" are never explained. These are the three most important words in the document and they're undefined.

**Fix:** Add a Glossary section defining ARCADE, defect, CS, owner team, signal, defect entity, lifecycle, issue type, and campaign. Clarify where "defect" means raw signal vs. deduplicated entity vs. Steward tracking record.

---

### 5. §What We Build — Identity Graph is a multi-year problem in one paragraph
`premortem` `antagonist` `sukhpal`

> "The code is cheap. The cross-signal breadth is not."

The doc correctly labels this "the hardest technical problem" but provides zero technical approach — no architecture, no data sources enumerated, no accuracy targets, no phased rollout. Entity resolution across heterogeneous signals (contacts, returns, seller complaints, FC reports) with different schemas, latencies, and data classifications is one of the hardest problems in applied ML. "The code is cheap" contradicts the complexity. A merge bug that links unrelated defects cascades into wrong SLA assignments and corrupted scorecards — with no described quarantine mechanism.

**Fix:** Add at minimum: data source enumeration, entity resolution approach (ML vs rule-based vs hybrid), accuracy targets, phased rollout (start with one defect type in one marketplace), and a reference to existing entity resolution systems at Amazon. Address the ops concern: what happens with partial data when one channel is unavailable?

---

### 6. §The Problem — Data retention non-compliance: mentioned once, never addressed
`premortem` `sukhpal`

> "The tracking system itself has been non-compliant with Amazon data retention requirements since 2021."

This is dropped as a one-liner and never revisited. The entire Defect Intelligence Layer ("no team can replicate a year of validated outcomes") depends on long-term data retention that the doc itself admits is currently non-compliant. For a system processing customer interaction data at Amazon scale, this is a launch blocker hiding in plain sight.

**Fix:** Link to the compliance finding or SAS risk. Add a section on how Steward handles data classification, retention policies, and Legal/Privacy approval. Acknowledge the tension between the learning loop's need for historical data and data minimization requirements.

---

## 🟡 Should Address

### 7. §Throughout — No scope statement: what IS this document?
`sukhpal`

Is this a vision doc? An HLD? A 2027 planning proposal? It reads like all three. Reviewers can't calibrate expectations.

**Fix:** Add a Scope section: "This is a [vision/strategy] document for 2027 planning. Separate design docs will follow for [components]."

---

### 8. §The Idea — Shepherd analogy: why not extend Shepherd?
`sukhpal`

If the model is identical — severity, owner, SLA, escalation — why build new? Why not extend Shepherd to support defects?

**Fix:** Add a paragraph explaining why Shepherd can't be extended (different data model, different org ownership, etc.) or acknowledge it as an option to explore.

---

### 9. §What We Build — Verification Engine: what if verification itself is wrong?
`sukhpal` `ops`

If verification produces false positives at scale, it triggers mass re-escalation — a political incident, not just a technical one. If false negatives, defects silently escape. No confidence thresholds, dispute mechanism, or accuracy monitoring.

**Fix:** Add a section on verification confidence, false positive handling, dispute/appeal for owners, and accuracy monitoring.

---

### 10. §What We Build — Steward has no described failure modes
`ops`

Steward is "the product" and the single system of record. If it's down: do SLAs pause or do owners get falsely escalated? Does data get lost or queued? Does recovery trigger a wall of overdue escalations?

**Fix:** Add a paragraph on degradation modes, circuit breakers (per-campaign pause, escalation rate limiting), and SLA grace periods during outages.

---

### 11. §What We Build — Use-Case Agents have no contract or observability
`sukhpal` `ops`

Agents are "disposable" but feed into a "durable" system of record. What's the interface? What inputs from Steward, what outputs required? If a Wrong Item Agent produces bad resolutions at scale, how is that detected? "Disposable" agents without a trust boundary are an operational red flag.

**Fix:** Define the agent contract and trust boundary with Steward.

---

### 12. §What We Build — Intelligence Layer is a research program, not a component
`antagonist`

It depends on verification data that doesn't exist yet, from a system that hasn't been adopted, backed by authority that hasn't been granted. Listing it alongside concrete systems like Steward is misleading. The "compounding moat" is theoretical for 12–18 months. What keeps leadership patient during the trough?

**Fix:** Acknowledge the bootstrapping timeline explicitly. Frame as a phased build that becomes valuable after N months of verification data accumulates.

---

### 13. §The Opportunity — Enforcement claim needs evidence
`sukhpal`

> "If a seller fixes a misleading listing in hours, suppression is unnecessary."

Do we have data showing faster resolution reduces enforcement need? What percentage of current enforcements could plausibly be fixed in hours?

**Fix:** Add 1–2 data points on the enforcement-speed relationship.

---

### 14. §Throughout — No tenets
`sukhpal`

Implicit tradeoffs (accountability over autonomy, verified closure over speed) are never stated.

**Fix:** Add 3–5 tenets.

---

### 15. §What Changes — Missing context on Detection Agent, Triage Agent, measurement telemetry
`naive`

Referenced as 2026 foundation work but never explained. A reader can't assess whether the foundation is solid.

**Fix:** Add a sentence each on what these are and their current status.

---

## 🔵 Nits

### 16. §The Opportunity — Broken markdown
`sukhpal` `naive`

> "The gap isn't in detection or investigation** — it's in everything after"

Stray `**` breaks the bold formatting.

---

### 17. §What We Build — "from most durable to most disposable" ordering is off
`sukhpal`

Campaign Framework is listed before Identity Graph — is it really more durable?

---

### 18. §What Changes — Section title is vague
`sukhpal`

"What Changes" could mean anything. Suggest: "How This Connects to 2026 Work."

---

### 19. §What Success Looks Like — No measurable targets for Steward
`sukhpal` `antagonist`

> "ARCADE becomes the team that knows more about what actually eliminates defects at Amazon than anyone"

This is a mission statement, not a metric. What's the target for the 65% unresolved rate? By when?

**Fix:** Add 2–3 Steward-specific targets: owner assignment rate, SLA compliance, verified closure rate.

---

### 20. §Throughout — Undefined terms: "offer suppression," "badge removal," deduplication scope
`naive`

Enforcement mechanisms, "issue type" vs "defect type," and what deduplication operates on are all unclear to new readers.

---

## ✅ What's Good

- **Problem statement is excellent** — the structural cause analysis ("CS detects but doesn't own resolution") is precise and actionable. All 5 personas rated this highly.
- **"Building is cheap" framing is brave and correct** — acknowledging your own platform play is threatened by commoditization and pivoting toward what can't be commoditized is the right strategic instinct. (`antagonist`, `sukhpal`)
- **Disposable-to-durable layering is sound** — agents as disposable, identity/verification/learning as durable, accountability as the product. (`antagonist`, `sukhpal`, `ops`)
- **"Closure requires evidence, not a status change"** — the single best sentence in the doc. If the entire initiative were just Steward + Verification Engine, confidence in shipping would be higher. (`antagonist`)
- **Verified closure as explicit state (Pending Verification)** — creates a visible, queryable, auditable state. Operationally sound. (`ops`)
- **Concise** — makes its argument in ~1,800 words. Appropriate for a strategy/vision doc. (`sukhpal`)

---

## Pre-Mortem Scenarios

| # | Scenario | Type | Root Cause |
|---|----------|------|-----------|
| 1 | Steward launches, owner teams treat it like current tickets — 65% unresolved rate barely moves | 🐅 Tiger | No organizational authority behind "mandatory" |
| 2 | Identity Graph prototype works for 1 defect type in NA at 60% precision — not reliable enough for Steward | 🐅 Tiger | Multi-year data engineering problem given one paragraph |
| 3 | Team tries to build all 6 components concurrently — nothing reaches production quality | 🐅 Tiger | No sequencing, staffing, or prioritization |
| 4 | Legal flags data retention non-compliance — Intelligence Layer descoped | 🐘 Elephant | Acknowledged in one sentence, never addressed |
| 5 | Owner teams dispute attribution, challenge severity, escalate to VPs — pilot scoped to voluntary | 🐘 Elephant | Zero words on political resistance |
| 6 | "Other teams will build their own pipeline" | 📄 Paper Tiger | Actual risk is indifference, not competition |

---

## Ops Readiness Matrix

| Component | Failure Mode | Detection | Diagnosis | Remediation | Status |
|---|---|---|---|---|---|
| Steward | Complete outage | ❌ | ❌ | ❌ | Not discussed |
| Steward | Escalation storm | ❌ | ❌ | ❌ | No circuit breaker |
| Identity Graph | Bad merge | ❌ | ❌ | ❌ | No quarantine |
| Identity Graph | Partial data | ❌ | ❌ | ❌ | Not discussed |
| Verification | False positives at scale | ❌ | 🟡 | ❌ | No dispute mechanism |
| Intelligence Layer | Feedback corruption | ❌ | ❌ | ❌ | No rollback |
| Campaign | Volume explosion | ❌ | 🟡 | ❌ | No per-campaign pause |
| Agents | Bad output at scale | ❌ | ❌ | ❌ | No trust boundary |

---

## Severity Summary

| Severity | Count |
|----------|-------|
| 🔴 Blocking | 6 |
| 🟡 Should Address | 9 |
| 🔵 Nit | 5 |

---

## Per-Persona Raw Reviews

<details><summary>Sukhpal Simulation</summary>
See docrev-0422-1645-sukhpal-result.md
</details>

<details><summary>Pre-Mortem</summary>
See docrev-0422-1645-premortem-result.md
</details>

<details><summary>Antagonist</summary>
See docrev-0422-1645-antagonist-result.md
</details>

<details><summary>Naive Reader</summary>
See docrev-0422-1645-naive-result.md
</details>

<details><summary>Ops Consumer</summary>
See docrev-0422-1645-ops-result.md
</details>
