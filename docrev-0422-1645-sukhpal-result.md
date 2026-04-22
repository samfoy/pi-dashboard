# Sukhpal Review Simulation

> Reviewing: **ARCADE 2.0: Every Defect Has an Owner**
> Author: Sukhpal Singh
> Reviewer persona: Peer PE using Sukhpal's own review lens

---

## 🔴 Blocking (would ask before approving)

### No diagrams anywhere

The entire doc proposes "Six components in three layers" with no architecture diagram, no sequence diagram, no data flow. You wrote "the mandate (Steward, Campaign Framework), the intelligence (Identity Graph, Verification Engine, Defect Intelligence Layer), and the execution (Use-Case Agents)" — should we add at minimum a layered architecture diagram? Or a sequence diagram showing how a defect flows from detection through verification and into the intelligence layer? I can't evaluate the component boundaries without seeing them.

**Fix:** Add a system-level architecture diagram showing layers, component boundaries, and data flow. Add a sequence diagram for the core lifecycle: defect detected → identity resolved → owner assigned → SLA tracked → fix verified → intelligence updated.

---

### No data model for any component

The doc names six components and describes none of their schemas. "The Defect Identity Graph" — what's the primary key? How do you link "50 customer contacts, 12 returns, 3 seller complaints, 2 fulfillment center reports"? What does the entity look like? Same for Steward — what's a defect record? What are the access patterns? What does "Pending Verification" look like as a state machine?

**Fix:** Add a Data Model section (even HLD-level) for at least Steward and the Identity Graph. Define entity shapes, primary keys, and top access patterns. Define the defect lifecycle states explicitly (Open → Assigned → In Progress → Pending Verification → Verified Fixed / Recurred).

---

### No glossary

The doc uses "defect," "signal," "defect entity," "lifecycle," "campaign," "use-case agent," "defect type," "issue type" — some interchangeably. "Defect" alone appears to mean different things: a raw detection signal, a deduplicated entity, and a Steward tracking record. Which is it in each context?

**Fix:** Add a Glossary section at the top. Sukhpal starts every doc he writes with one — this one needs it more than most given the overloaded terminology.

---

### Steward vs Shepherd: why not extend Shepherd?

"Build Steward, a system that does for defects what Shepherd does for security vulnerabilities." If the model is identical — severity, owner, SLA, escalation — why build a new system? Why not extend Shepherd to support defect tracking? Any reason we can't reuse Shepherd's infrastructure and just add defect-specific semantics? The doc doesn't address this.

**Fix:** Add a paragraph explaining why Shepherd can't be extended (different data model, different org ownership, different SLA semantics — whatever the reason is). If it can be extended, that changes the entire build scope.

---

### "365 million defect reductions per year" entitlement — where does this number come from?

"Amazon's entitlement is 365 million defect reductions per year. Amazon realizes roughly a quarter of that." This is the central business justification for the entire proposal. There's no methodology, no link, no citation. How was this calculated? Is it unique defects × resolution rate? Is it customer contacts avoided? The 75% gap is the core argument — it needs evidence.

**Fix:** Add a footnote or appendix with the methodology. Link to the analysis or model that produced 365M. State what "defect reduction" means concretely (unique defects fixed? customer contacts prevented? CX events avoided?).

---

### No execution plan at all

Six components across three layers proposed for 2027 planning. No timeline, no staffing, no build order, no critical path, no dependencies. "With our 2026 goals as the foundation, this is the direction we propose for 2027 planning" — what's the actual ask? What gets built first? What's the team size? How many of the six components can we realistically staff?

**Fix:** Add a Phasing section. At minimum: what's P0 (must ship first because everything depends on it), what's P1, what can wait. Name the critical path. State the team size assumption. If this is a vision doc and not a plan, say that explicitly — but then scope what IS the plan.

---

## 🟡 Should Address

### No scope statement — what is this doc?

Is this a vision doc? An HLD? A 2027 planning proposal? It reads like all three. "shouldn't we create different documents for each system?" At minimum, state what the doc IS and ISN'T up front so reviewers calibrate expectations. The Verification Engine alone needs its own design doc.

**Fix:** Add a "Scope" section after the title: "This document is a [vision doc / strategy proposal] for 2027 planning. It is NOT an HLD or LLD for any individual component. Separate design docs will follow for [X, Y, Z]."

---

### No tenets

There's no tenets section. The doc makes implicit tradeoffs (accountability over autonomy, verified closure over speed, centralized record over team-level tracking) but doesn't state them. "other tenets felt more like non-technical requirements" — but here there are no tenets at all.

**Fix:** Add 3–5 tenets that guide the design. Example: "Verified outcomes over reported outcomes — we prefer slower closure with evidence over fast closure without it."

---

### "non-compliant with Amazon data retention requirements since 2021" — bold claim, no evidence

"The tracking system itself has been non-compliant with Amazon data retention requirements since 2021." This is a serious compliance assertion. Where's the audit finding? The SAS risk? The ticket? If this is true, it strengthens the argument significantly — but it needs a citation.

**Fix:** Link to the specific compliance finding, SAS risk ID, or audit report. If it's informal knowledge, soften the language or get it formally documented first.

---

### Verification Engine — what happens when verification is wrong?

"For every resolved defect: did the fix work? Did the defect recur? Was the improvement caused by the fix or by something else?" — good questions, but how? What's the false positive rate on "recurrence"? If verification wrongly says a fix didn't hold, owners lose trust and ignore Steward. What's the fallback? We need to have a fallback too.

**Fix:** Add a section on verification confidence, false positive handling, and the dispute/appeal mechanism for owners who believe verification is incorrect.

---

### "Use-Case Agents" are described but not bounded

"A Wrong Item Agent handles detection, investigation, and resolution end to end" — what's the interface between a Use-Case Agent and Steward? Between an agent and the Identity Graph? If agents are "disposable," what's the contract they must implement? Without that contract, "disposable" means "impossible to maintain."

**Fix:** Define the agent contract: what inputs does it receive from Steward, what outputs must it produce, what APIs does it call on the Identity Graph and Verification Engine.

---

### Campaign Framework — how is this different from what exists?

"CS defines which defects Amazon should care about — 'we're going after expired products in grocery this quarter' — sets detection criteria and SLAs." Do we have this today in some form? How do CS leaders currently prioritize? Is this a new tool or formalizing an existing process? Any reason we're building a framework instead of using an existing program management tool?

**Fix:** Add a sentence on current-state campaign/prioritization process and why it's insufficient.

---

### Enforcement claim needs nuance

"If a seller fixes a misleading listing in hours, suppression is unnecessary. Enforcement remains necessary for bad actors and safety issues, but it stops being the primary mechanism — removing the most politically contentious part of the current system." This is a strong claim that enforcement mostly goes away. Do we have any anecdotes or data showing that faster resolution reduces enforcement need? What percentage of current enforcements are on defects that could plausibly be fixed in hours?

**Fix:** Add 1–2 concrete examples or data points showing the enforcement-speed relationship. Acknowledge the subset of defects where enforcement is unavoidable regardless of speed.

---

### Identity Graph — who has built this before?

"Resolving these into a single defect entity requires simultaneous access to every customer channel." Has anyone at Amazon attempted cross-signal entity resolution at this scale before? Are there lessons from Retail fraud detection, abuse prevention, or other identity resolution systems? The doc positions this as the hardest technical problem but doesn't reference prior art.

**Fix:** Add a brief survey of existing entity resolution systems at Amazon and what can be reused vs. what's novel.

---

## 🔵 Nits

### "from most durable to most disposable" — ordering is unclear

"Six components in three layers... from most durable to most disposable." The listed order is Steward, Campaign Framework, Identity Graph, Verification Engine, Defect Intelligence Layer, Use-Case Agents. Is Campaign Framework really more durable than the Identity Graph? The claim doesn't match the ordering.

**Fix:** Either reorder the components to match the durability claim or drop the phrase.

---

### "What Changes" section title is vague

"What Changes" could mean organizational change, technical change, or strategic change. It's actually about continuity — how current work connects to the proposal.

**Fix:** Rename to something like "How This Connects to 2026 Work" or "Transition from Current State."

---

### Missing "detection" in the gap statement

"The gap isn't in detection or investigation** — it's in everything after" — there's a stray `**` (broken bold markdown) in this sentence.

**Fix:** Fix the markdown: "The gap isn't in detection or investigation — it's in everything after: accountability, verification, and learning."

---

### "What Success Looks Like" has no measurable targets for Steward

The section restates 2026 goals (48-hour investigation, weeks for onboarding) but doesn't define Steward-specific success metrics. What percentage of defects should have owners within 6 months? What's the target verified-closure rate? What SLA compliance rate makes Steward a success?

**Fix:** Add 2–3 measurable targets specific to the new components: owner assignment rate, SLA compliance rate, verified closure rate, repeat defect reduction.

---

## ✅ What's Good

- **Problem framing is sharp.** The structural cause analysis — "CS detects but doesn't own resolution" — is precise and actionable. The connection between the accountability gap and the learning gap is well drawn.
- **Honest about what's commoditized.** "When building your own costs less than adopting someone else's, no platform pitch survives" — this is the right strategic read. Not many docs admit their own platform play is obsolete.
- **Disposable vs. durable distinction.** Separating agents (disposable) from infrastructure (durable) is the right framing and avoids the trap of over-investing in rapidly-changing agent tech.
- **Shepherd analogy is powerful.** Even though the doc needs to address "why not extend Shepherd," the mental model is immediately legible to any Amazon audience.
- **Concise.** The doc makes its argument in ~1,800 words. Meets the bar for a strategy/vision doc.
