# Pre-Mortem Review: ARCADE 2.0 — Every Defect Has an Owner

**Reviewer persona**: Pre-Mortem (Shreyas Doshi framework)
**Premise**: It's October 2026. Steward launched in Q3. By Q4 it's widely regarded as stalled. What happened?

---

## 🐅 Tigers (real threats, under-mitigated)

### 1. "Mandatory" Without a Mandate — The Shepherd Analogy Breaks Down

**Failure narrative**: Steward launched with CS leadership support but no VP+ mandate from the owner orgs (Retail, Marketplace, FBA). The Shepherd analogy was compelling in the doc — but Shepherd works because *Security* has executive-level authority to enforce SLAs on any team. CS has no such authority over the teams that own defects. Owner teams treated Steward tickets the same way they treat current tickets: low priority, closed without action. The 65% unresolved rate barely moved. Six months in, CS leadership asked "where are the scorecards showing improvement?" and the answer was: the scorecards exist, but the numbers are the same.

**Cited gap**: The doc states *"Steward changes that. Owners see the full defect — investigation findings, customer impact, recommended actions. Leaders see organizational health through scorecards"* — but never addresses **who grants Steward mandatory authority**, what organizational mechanism enforces compliance, or what happens when an owner org's VP says "we have higher priorities." The Shepherd comparison (§ The Idea) assumes the mandate exists without describing how to obtain it. The escalation path is described as a feature of the system, not as an organizational commitment secured from leadership.

**Classification**: Tiger. The doc clearly understands accountability is the gap ("An owner can close the ticket without fixing anything, and no system notices") but the proposed solution — Steward — replaces a ticket-with-no-SLA with a ticket-with-an-SLA-and-no-enforcement-authority. The structural cause hasn't changed; it's been redecorated.

---

### 2. The Identity Graph Is a Multi-Year Data Engineering Problem Described in One Paragraph

**Failure narrative**: The team started building the Identity Graph in Q2 and quickly discovered that "simultaneous access to every customer channel" meant integrating 8+ upstream data sources with different schemas, latencies, access controls, and data classification levels. The entity resolution problem — linking 50 contacts, 12 returns, 3 seller complaints into one defect — required ML models that needed labeled training data they didn't have. By Q3, they had a prototype that worked for Wrong Item in NA-only with 60% precision. It wasn't reliable enough for Steward's "verified closure" to be trusted. The Verification Engine, which depends on Identity Graph output, couldn't launch. The entire learning loop stalled at layer one.

**Cited gap**: The doc says *"Resolving these into a single defect entity requires simultaneous access to every customer channel — chat, returns, seller complaints, fulfillment reports — across all categories and marketplaces. The code is cheap. The cross-signal breadth is not."* (§ What We Build). The doc correctly identifies this as "the hardest technical problem" but provides zero technical approach — no architecture, no data source enumeration, no accuracy targets, no phased rollout. The sentence "the code is cheap" directly contradicts the complexity of cross-category, cross-marketplace entity resolution at 86M defects/year scale.

**Classification**: Tiger. Acknowledged as hard, allocated one paragraph. The phrase "the code is cheap" is a red flag — entity resolution across heterogeneous signals is one of the hardest problems in applied ML, and the doc waves it away to emphasize data *access* as the moat. Access is necessary but insufficient.

---

### 3. Six Components, One Team, Zero Sequencing

**Failure narrative**: The team tried to build Steward, Identity Graph, Verification Engine, Intelligence Layer, Campaign Framework, and Use-Case Agents concurrently. With a team of ~15-20 engineers also maintaining ARIA and the existing detection pipeline, nothing reached production quality. Steward launched with manual defect-to-owner routing because the Identity Graph wasn't ready. The Verification Engine launched with a simple "defect recurred Y/N" check because the Intelligence Layer wasn't feeding it. Each component was a hollow version of what the doc promised. Leadership saw a dashboard with bad data and lost confidence.

**Cited gap**: § What We Build describes six components across three layers and labels them "from most durable to most disposable" — but provides **no build order, no dependency graph, no staffing plan, no phased delivery milestones**. The doc doesn't mention team size, current obligations (ARIA maintenance, 2026 detection goals), or trade-offs if delivery slips. The only timeline reference is the final line: *"this is the direction we propose for 2027 planning."*

**Classification**: Tiger. The doc frames this as a 2027 planning direction, which partially excuses missing timelines — but the problem is that six interdependent components with no sequencing invites the classic "boil the ocean" failure mode. A reader cannot assess feasibility without knowing what ships first.

---

## 📄 Paper Tigers (over-mitigated or not real)

### 4. "Other Teams Will Build Their Own" — The Platform Competition Narrative

**Failure narrative that *didn't* happen**: The doc spends significant energy arguing that other teams building their own investigation pipelines is *not* a threat but an opportunity. It preemptively defuses the "why not just let teams build their own ARIA" objection. In reality, no other Amazon team tried to build a competing defect accountability system. The actual threat wasn't competition — it was indifference. Owner teams didn't build alternatives; they simply didn't engage.

**Cited text**: The doc devotes ~300 words across § The Problem and § The Opportunity to the fragmentation/replication narrative: *"The same agent patterns are being independently rebuilt across the company"*, *"When building your own costs less than adopting someone else's, no platform pitch survives"*, *"What can't be replicated in two weeks: cross-organizational accountability..."*. This is a well-constructed argument against a threat that isn't the actual risk.

**Classification**: Paper Tiger. The doc is correct that agents are cheap to build, but it over-indexes on defending against platform competition when the real risk is that nobody cares enough to compete OR to adopt. The fragmentation narrative is an intellectual exercise that doesn't map to the actual failure mode (organizational apathy, not organizational competition).

---

## 🐘 Elephants (hidden, undiscussed)

### 5. Data Retention Non-Compliance — Mentioned Once, Never Addressed

**Failure narrative**: Three months after Steward launched, Legal flagged that the system was ingesting and persisting customer interaction data with no compliant retention policy — extending the same non-compliance the doc itself acknowledged. The project was paused for a compliance review. The "learning loop" — which requires storing verified outcomes over time — was fundamentally at odds with data minimization requirements. The Intelligence Layer, designed to compound knowledge from historical resolutions, had to be descoped because retaining that data for years was never cleared with Legal or Privacy.

**Cited gap**: § The Problem says *"The tracking system itself has been non-compliant with Amazon data retention requirements since 2021"* — and then the doc **never mentions it again**. The entire Defect Intelligence Layer premise (*"No team starting from scratch can replicate a year of validated outcomes"*) depends on long-term data retention that the doc itself admits is currently non-compliant. This is not a minor footnote — it's a structural blocker for the core value proposition.

**Classification**: Elephant. A single sentence acknowledges a 5-year-old compliance violation, then the doc proposes building a system that *requires even more* long-term data persistence. No section addresses how Steward handles data classification, retention policies, or Legal/Privacy approval. For a system processing customer interaction data at Amazon scale, this is a launch blocker hiding in plain sight.

---

### 6. Owner Team Political Resistance — The Scorecard Is a Weapon, Not a Dashboard

**Failure narrative**: When the first Steward scorecards went live, showing defect counts and SLA compliance by org, the reaction wasn't "great, now we have visibility" — it was immediate pushback. Owner teams disputed defect attribution ("that's not our defect"), challenged severity classifications ("this isn't P1"), and escalated to their VPs that CS was unilaterally imposing SLAs on their roadmaps. The pilot was scoped down to "voluntary participation" within two months. The forcing function became a suggestion.

**Cited gap**: The doc never discusses **how owner teams will react** to mandatory tracking and public scorecards. The Shepherd analogy again misleads — security vulnerabilities have cross-company consensus on severity frameworks (CVSS). Defect severity has no such consensus. Who decides a Wrong Item is P1 vs. P2? The doc says *"Leaders see organizational health through scorecards: open defects by severity, SLA compliance, repeat defect rate"* (§ The Idea) but doesn't address the political reality that scorecards are zero-sum: one team's "you have 200 open P1 defects" is that team's "CS is dumping unvalidated work on our backlog."

**Classification**: Elephant. This is the most likely cause of actual project failure and it receives zero words. The doc is a technical and strategic document that ignores the organizational change management required to make mandatory accountability work across Amazon's decentralized structure.

---

## Risk Attention Mismatch

| Risk Area | Approx. Words | Actual Threat Level | Mismatch? |
|---|---|---|---|
| **Platform competition / "other teams will build their own"** | ~300 (Problem + Opportunity) | Low — teams won't compete, they'll ignore | ⚠️ **Over-indexed** — most-discussed risk is least likely to kill the project |
| **Investigation speed / ARIA capability** | ~250 (Opportunity + What Changes) | Low — 2026 goals are on track | ⚠️ **Over-indexed** — used as evidence of progress, but investigation isn't the bottleneck anymore |
| **Organizational mandate / authority to enforce** | ~50 (one clause in The Idea) | **Critical** — without it, Steward is a dashboard nobody uses | 🔴 **Severe mismatch** — existential risk gets one sentence |
| **Identity Graph technical complexity** | ~120 (What We Build) | High — multi-year ML/data problem | 🔴 **Under-indexed** — "hardest technical problem" gets less text than the platform competition defense |
| **Data retention / compliance** | ~25 (one sentence in Problem) | High — acknowledged blocker, never addressed | 🔴 **Severe mismatch** — mentioned, then abandoned |
| **Owner team political resistance** | 0 | **Critical** — the most likely cause of failure | 🔴 **Absent** — the doc's biggest blind spot |
| **Build sequencing / team capacity** | 0 | High — six components, no phased plan | 🔴 **Absent** — excusable for a strategy doc, but readers can't assess feasibility |

### Summary

The doc spends its word budget on two things: (1) arguing that cheap-to-build agents aren't a competitive threat, and (2) describing what Steward does. It spends almost nothing on (a) how to obtain the organizational authority that makes Steward mandatory, (b) how to handle the political fallout of imposing accountability scorecards on peer orgs, or (c) how to resolve a 5-year-old data compliance violation that structurally conflicts with the core "learning loop" value proposition.

The most likely post-mortem headline: **"Steward was a well-designed system that nobody was forced to use."** The second most likely: **"The Identity Graph never reached production quality, so verified closure was untrustworthy."** Neither failure mode receives adequate attention in the current doc.
