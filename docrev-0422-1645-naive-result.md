# Naive Reader Review: ARCADE 2.0 — Every Defect Has an Owner

**Reviewer persona**: SDE who joined the team last Monday. General SWE background, zero project context.

---

## 🔴 Lost (can't continue without this context)

### 1. What is ARCADE?
The document title says "ARCADE 2.0" and the text uses "ARCADE" throughout as a proper noun — but never defines it. Is it an acronym? A product name? A team name? Paragraph 1 says "ARCADE ingests 14% of them" (so it's a system). Later: "We stop pitching ARCADE as a platform" (so it's been positioned as a platform). Even later: "ARCADE becomes the team that knows more…" (so it's a team?). The reader can't tell if ARCADE is a product, a platform, a team, or all three — and this is the subject of the entire document.

### 2. What is ARIA?
Introduced in §The Problem as "our investigation agent" with no expansion of the acronym and no explanation of what it actually does. It "reached comparable accuracy" to science models — accuracy at what? Investigation? Root cause prediction? The text uses "investigation accuracy" later (72%) but doesn't explain what investigation means in this context (reading tickets? classifying defects? recommending actions?).

### 3. What does "defect" mean here?
This is the most important term in the document and it's never defined. In standard SWE, a defect is a software bug. Here it seems to mean something a customer experienced — a wrong item, an expired product, a misleading listing. Is every negative customer experience a "defect"? Is it a defect in the product, the listing, or the seller's process? The document uses "defect" 40+ times and I'm guessing at what it means every time.

### 4. What does "CS" stand for and what is its role?
"CS detects and investigates defects but doesn't own resolution." CS is never expanded. Presumably Customer Service — but does CS mean the org, a specific team, a set of tools? Later: "CS defines which defects Amazon should care about" — that's a very different role from detection. Which CS are we talking about?

### 5. Who are "owner teams"?
"Owner teams receive a ticket with no SLA" — who are these teams? Are they sellers? Internal Amazon teams? Product teams? The entire accountability model hinges on understanding who the "owner" is, and it's never explained.

---

## 🟡 Confused (can work around but shouldn't have to)

### 6. "365 million defect reductions per year" entitlement
"Amazon's entitlement is 365 million defect reductions per year. Amazon realizes roughly a quarter of that." Where does this number come from? What does "entitlement" mean in this context — is it a ceiling, a forecast, a goal? What does "defect reduction" mean — one fewer defect occurrence? One defect fully eliminated? This is the central business justification and it's opaque.

### 7. What is Shepherd?
"Build Steward, a system that does for defects what Shepherd does for security vulnerabilities." The doc gives a one-sentence explanation of Shepherd, which helps — but if I haven't used Shepherd, I don't know whether it's beloved or hated, whether the analogy is aspirational or proven, or what "mandatory" actually means at Amazon (VP mandate? Tool enforcement? Org policy?). The analogy is load-bearing; a link or a paragraph would help.

### 8. The science models vs. ARIA comparison
"The science models that power ARCADE's root cause prediction took months to build and deploy through a batch pipeline. ARIA reached comparable accuracy in two weeks." Comparable accuracy on what benchmark? The same defect types? The same dataset? This comparison is central to the "building is cheap" argument but has no shared evaluation basis stated.

### 9. "Non-compliant with Amazon data retention requirements since 2021"
Which tracking system? What requirements? This is dropped as a one-liner but sounds like a serious compliance issue. A new reader can't assess severity without knowing what system and what policy.

### 10. Detection Agent, Triage Agent, measurement telemetry
§What Changes references "the Detection Agent, the Triage Agent, measurement telemetry" as things being built in 2026. These appear nowhere else in the document. Are they part of ARCADE? Part of ARIA? Separate systems? If they're the foundation Steward stands on, they need at least a sentence each.

### 11. "Investigation accuracy" numbers (72% vs 35–50% human baseline)
What does "investigation accuracy" measure? Is there a rubric? Does 72% mean 72% of investigations reached the correct root cause? 72% of recommended actions were right? Without knowing what's being measured, these numbers don't convey meaning.

### 12. How does the Defect Identity Graph actually work?
The doc says it "resolves [signals] into a single defect entity" and requires "simultaneous access to every customer channel." But it doesn't explain the mechanism — is it entity resolution? ML clustering? Rule-based matching? "The code is cheap" suggests it's straightforward, but the problem description (dozens of signals, different IDs, time windows) suggests it's not.

### 13. Campaign Framework vs. Steward relationship
Steward is described as the system of record. Campaign Framework is "how CS exercises its advocacy mission" by choosing which defects to go after. Who decides what goes into a Campaign vs. what Steward tracks automatically? Does every defect go through both? The boundary is unclear.

---

## 🔵 Minor Gaps

### 14. "Deduplication" — of what exactly?
"5 million unique defects that survive deduplication" — deduplication of what? Customer contacts? Detected signals? The pipeline stages (detection → dedup → investigation) are implied but never laid out.

### 15. "Offer suppression," "badge removal," "seller warnings"
These enforcement mechanisms are mentioned once as if the reader knows what they are. Offer suppression in particular — does this mean removing a product listing? Suppressing it from search? A new reader can guess but shouldn't have to.

### 16. "Wrong Item Agent" as the example
Used twice as the canonical example agent. Is Wrong Item the most common defect type? The easiest? The one we're building first? A sentence of context would anchor the example.

### 17. "No team outside CS has simultaneous access to every customer channel"
Is this a data access / authorization constraint? An organizational boundary? A technical integration issue? This is asserted as the key moat but the nature of the barrier isn't explained.

### 18. "Pending Verification" state
The doc says "the system re-checks whether the fix held" — re-checks how? With what signal? On what timeline? This is the core innovation (verified closure) but the mechanism is hand-waved.

### 19. What are "issue types" in "ARIA is live for several issue types"?
Is an "issue type" the same as a "defect type"? Examples would help (Wrong Item, expired product, etc.).

### 20. Formatting: bold fragment break
"The gap isn't in detection or investigation** — it's in everything after" has a stray `**` that breaks the bold formatting.

---

## Readability Score

| Dimension | Score | Notes |
|---|---|---|
| **Problem understanding** | 7/10 | The pain is vivid and well-argued — defects go unresolved, no learning loop, no accountability. Docked because "defect" itself is undefined and the pipeline stages are implied rather than stated. A new reader gets the shape of the problem but has to guess at key terms. |
| **Solution understanding** | 5/10 | The six components are named and described at a high level, but the relationships between them are fuzzy. Steward is "the product" but Campaign Framework is also in the mandate layer — how do they interact? The Identity Graph, Verification Engine, and Intelligence Layer are described by what they do, not how. A new reader leaves with a good elevator pitch but couldn't draw an architecture diagram. |
| **Can start contributing** | 3/10 | A new engineer reading this cannot tell: what code exists today, what's being built in 2026 vs. proposed for 2027, what team builds what, or where to look in the codebase. The document is a strategy pitch, not a working spec — which is fine for its purpose, but the undefined terms (ARCADE, ARIA, CS, defect, owner team) make it hard to even ask the right follow-up questions. |

### Summary
The document is well-written prose with a compelling narrative arc. The problem section is the strongest — vivid numbers and a clear structural diagnosis. The solution section names the right abstractions but doesn't define the key terms that a new reader needs to follow along. The biggest gap: **the three most important words in the document — ARCADE, defect, and CS — are never defined.**
