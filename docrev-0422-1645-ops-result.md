# Ops Consumer Review: ARCADE 2.0 — Every Defect Has an Owner

**Reviewer perspective**: Oncall engineer, 2am, something is broken.
**Document type**: Strategy/vision (not detailed design) — evaluated for operational concerns that should be addressed even at this level.

---

## 🔴 Oncall Blind Spots

### 1. Steward has no described failure mode, despite being the single system of record
Steward is the hub — SLA enforcement, escalation paths, scorecards, owner views. The doc says it's "the product." If Steward is down:
- Do SLAs pause or do owners get falsely escalated?
- Do agents keep enqueueing defects into a dead system? Is there backpressure or does work get lost?
- Does leadership see stale scorecards or broken dashboards? Can they tell the difference?

**The doc introduces a mandatory system with zero discussion of what happens when the mandatory system is unavailable.** At 2am, I don't know if I'm dealing with a data loss scenario or a cosmetic blip.

### 2. Verification Engine — "did the fix work?" has no discussion of "what if verification itself is wrong?"
The Verification Engine decides whether a defect recurred. If it produces false positives (says fix failed when it held), it triggers unnecessary re-escalation at scale — potentially thousands of bogus SLA violations hitting owners simultaneously. If it produces false negatives (says fix held when it didn't), defects silently escape.

- No mention of confidence thresholds, human-in-the-loop for ambiguous cases, or a mechanism to dispute a verification result.
- No mention of how an oncall would detect that verification is systematically wrong (drift in accuracy).
- This is a system that **automatically judges other teams' work**. A bad verification run is a political incident, not just a technical one.

### 3. Defect Identity Graph — misattribution blast radius is unbounded
The Identity Graph merges signals across every customer channel. A merge bug that incorrectly links unrelated defects or splits one defect into many has cascading effects:
- Wrong owners get SLA'd on defects they don't own.
- Scorecards show incorrect organizational health.
- Verified closures apply to the wrong entities.

**There is no discussion of: merge confidence scoring, manual override/split capability, or how to detect and remediate a bad merge after it propagates.** At 2am with a mismerge, I have no way to quarantine the bad data.

### 4. No emergency stop / circuit breaker for mandatory tracking
The doc's core thesis is "mandatory tracking — no team opts out." But mandatory systems need kill switches:
- If Steward is producing bad escalations at scale, can oncall pause escalation without taking the whole system down?
- If a Campaign is misconfigured (bad detection criteria → thousands of false defects), can it be suspended?
- The Shepherd analogy is telling — Shepherd has override mechanisms and severity reclassification. No equivalent is mentioned here.

### 5. Use-Case Agents — no observability contract
Agents are described as "cheap to build and cheap to replace" and "disposable." That's an operational red flag without guardrails:
- If a Wrong Item Agent starts producing bad resolutions, how is that detected? By whom?
- What's the contract between an agent and Steward? Does Steward trust agent output blindly?
- "Disposable" agents that feed into a "durable" system of record need a trust boundary. None is described.

---

## 🟡 Incomplete Runbook

### 1. SLA enforcement degradation modes
The doc mentions SLAs and escalation paths but not:
- What happens when an upstream dependency (e.g., the detection pipeline) is delayed — do SLA clocks start from detection time or ingestion time?
- Grace periods during outages — if Steward is down for 4 hours, do all SLAs shift by 4 hours or do owners get hit with a wall of overdue escalations on recovery?
- Rate limiting on escalation — can a bad data burst trigger thousands of simultaneous VP-level escalations?

### 2. Defect Intelligence Layer — learning loop corruption
The Intelligence Layer "learns which fix types work" from verification data. This is a feedback loop — if verification data is wrong, the Intelligence Layer learns the wrong lessons, which then inform future recommendations, which produce worse outcomes.
- No mention of how to detect model drift or recommendation degradation.
- No mention of how to roll back a bad learning update.
- At strategy level, this should at least acknowledge the feedback loop risk and commit to an evaluation framework.

### 3. Campaign Framework — who's oncall for a campaign?
Campaigns are "CS defines which defects Amazon should care about." But:
- Who owns the operational health of a campaign? CS defines it, but ARCADE runs it.
- If a campaign's detection criteria produce 10x expected volume, who gets paged?
- Can a campaign be paused without pausing the entire system?

### 4. Cross-channel dependency — "simultaneous access to every customer channel"
The doc proudly notes the Identity Graph needs "simultaneous access to every customer channel — chat, returns, seller complaints, fulfillment reports." This is also a massive dependency surface:
- If one channel (e.g., returns data) is delayed or unavailable, does the Identity Graph produce partial results? Wait? Fail?
- Partial data handling is not mentioned anywhere. At 2am, I need to know: is it safe to operate on incomplete data, or does that corrupt the graph?

---

## ✅ Well-Covered

### 1. Problem framing is operationally honest
The doc clearly identifies the current operational gap: "no system checks whether the fix held," "an owner can close the ticket without fixing anything, and no system notices." This is good — it names the failure modes of the current system, which gives future oncall context on *why* these new systems exist.

### 2. Verification as an explicit state (Pending Verification)
The explicit `Pending Verification` state is operationally sound. It creates a visible, queryable state that oncall can inspect. This is better than implicit "we'll check later" — it's auditable.

### 3. Separation of durable vs. disposable components
The layering (mandate → intelligence → execution) with explicit durability expectations is good for operational prioritization. Oncall knows: Steward down = sev2, agent down = degraded but recoverable.

### 4. Shepherd analogy provides operational precedent
Shepherd is a well-understood system internally. Referencing it sets expectations for the operational model (severity-based SLAs, escalation paths, override mechanisms) — though the doc needs to explicitly commit to those operational features, not just invoke the analogy.

---

## Failure Mode Matrix

| Component | Failure Mode | Detection | Diagnosis | Remediation | Gap |
|---|---|---|---|---|---|
| **Steward** | Complete outage | ❌ Not discussed | ❌ No dependency map | ❌ No failover/queue strategy | Does data get lost or queued? Do SLAs pause? |
| **Steward** | Bad escalation storm (data burst) | ❌ No rate-limit mention | ❌ No escalation audit trail described | ❌ No circuit breaker | Thousands of false VP escalations = political sev1 |
| **Identity Graph** | Incorrect merge (links unrelated defects) | ❌ No confidence scoring | ❌ No merge audit/split capability | ❌ No quarantine mechanism | Bad merges propagate to SLAs, scorecards, verification |
| **Identity Graph** | Partial channel data (one source delayed) | ❌ No staleness detection | ❌ No partial-data indicator | ❌ No degraded-mode behavior defined | Does it wait, skip, or produce incomplete entities? |
| **Verification Engine** | Systematic false positives | ❌ No accuracy monitoring | 🟡 Could query re-escalation rate | ❌ No dispute/override mechanism | Mass false re-escalation of "fixed" defects |
| **Verification Engine** | Systematic false negatives | ❌ No accuracy monitoring | ❌ Silent — defects escape | ❌ No way to trigger re-verification | Defeats the doc's core value prop |
| **Intelligence Layer** | Feedback loop corruption | ❌ No model eval framework | ❌ No recommendation quality metric | ❌ No rollback for learned models | Bad verification → bad learning → worse recommendations |
| **Campaign Framework** | Misconfigured campaign (volume explosion) | ❌ No volume guardrails | 🟡 Visible via Steward metrics maybe | ❌ No per-campaign pause | 10x defect volume floods owners and agents |
| **Use-Case Agents** | Agent produces wrong resolutions at scale | ❌ No agent-level quality monitoring | ❌ No trust boundary with Steward | ❌ No agent-level kill switch | Bad agent output becomes durable in system of record |
| **Use-Case Agents** | Agent goes down | 🟡 Presumably detectable | 🟡 Presumably loggable | ❌ No fallback path described | "Disposable" but what happens to in-flight defects? |
| **Cross-system** | Steward recovery after outage | ❌ No replay/backfill strategy | ❌ No data reconciliation process | ❌ No SLA grace period mechanism | Recovery could be worse than the outage |

---

## Summary

**This doc proposes making defect tracking mandatory across Amazon with no discussion of what happens when the mandatory system breaks.** That's the central ops gap.

The strategy is sound — verified closure and accountability are real needs. But the operational implications of "mandatory" are severe: you can't make something mandatory and then not have a plan for when it's wrong or unavailable. Shepherd (the cited analogy) has override mechanisms, severity reclassification, SLA pauses during outages, and dispute processes. This doc needs to commit to equivalent operational machinery, even at strategy level.

**Three things to add before this leaves strategy phase:**

1. **Degradation modes for Steward** — what happens during outage, recovery, and bad-data scenarios. Even one paragraph establishes the operational contract.
2. **Circuit breakers and kill switches** — per-campaign pause, escalation rate limiting, agent-level disable. Mandatory systems without emergency stops are ticking time bombs.
3. **Trust boundaries** — where does the system trust automated output vs. require human confirmation? Especially for the Verification Engine (which judges other teams' work) and agent output (which feeds into the durable system of record).

Without these, the 2am oncall for this system is flying blind on a mandatory platform that every team at Amazon depends on.
