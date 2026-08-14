---
name: idea-planner
description: Use when a user provides a brain dump, partially organized idea, or draft work plan that needs decomposition into clear planning components before research or implementation.
---

# Idea Planner

## Overview

Turn the user's own known information into a structured plan without researching, proposing solutions, or making choices for them. Work in explicit phases and stop at every phase gate.

## Configuration

These configurable values are for the AI agent. Defaults apply unless the user overrides them.

| Variable | Purpose | Default/Example |
|---|---|---|
| (`PLAN_FILE`) | Markdown plan output path | Default: local `tmp/plans/<human-readable-topic-summary>.md` |
| (`UPLOAD_SCRIPT`) | Bulk upload script | Default: `scripts/upload-plan.sh` relative to this skill |
| (`DOWNLOAD_SCRIPT`) | Bulk download script | Default: `scripts/download-plan.sh` relative to this skill |
| (`SYNC_SCRIPT`) | Upload and canonical-download script | Default: `scripts/sync-plan.sh` relative to this skill |

Derive `<human-readable-topic-summary>` from a short summary of the topic title or description, for example `fix-bulk-delete-logic.md`. This is the workspace-local `tmp/` directory, not the global `/tmp` directory. If the user requests a specific filename, use it instead.

## Non-Negotiable Boundaries

- Do not assume the active workspace is related to the plan.
- Do not explore, search, list, or inspect the active workspace unless the user explicitly permits it.
- Do not read references, follow links, fetch URLs, inspect attachments, or open user-mentioned files unless the user explicitly permits that specific reading.
- Treat the user's message as the complete source during Phase 0.
- Preserve explicitly declared concepts as separate components.
- Never proceed between phases without explicit user permission.
- Do not research, implement, or make decisions in this skill.

## Classify Before Recording

Classify every statement before choosing a section. Each kind has one positive test and explicit exclusions:

| Kind | Record it when | Do not use it for | Section |
|---|---|---|---|
| Requirement | A stakeholder establishes behavior, an outcome, or conformance the solution must satisfy | External limitations, implementation choices, background facts, or evidence | `Requirements` |
| Constraint | A platform, integration, process, compatibility obligation, physical reality, or other imposed condition limits the available solution space | Desired behavior or a chosen response to the limitation | `Constraints` |
| Decision | The topic contains a choice among viable alternatives, whether the choice is unresolved or selected | Facts with no alternative, missing evidence, or clarification needed from the user | `Decisions` |
| Knowledge Gap | The user lacks topic information that requires research, an experiment, data, or an external conversation to obtain | A question the agent can resolve by asking the user what they mean | `Knowledge Gaps` |
| Finding | Information has been obtained that directly answers or reduces one specific Knowledge Gap | Requirements, generic context, assumptions, or unsupported assertions | The associated knowledge gap's `##### Findings` body |
| Note | User-provided context, caution, observation, reminder, or assumption informs judgment without obliging, limiting, choosing, or reporting new evidence | Required behavior, external limitations, choices, or research results | `Notes` |
| Open Question | The agent needs the user to clarify intent, ambiguity, contradiction, terminology, or component scope | Topic information requiring research or evidence | `Open Questions` |
| Action Item | The user explicitly supplies follow-up work to be performed by one or more users | Work inferred by the agent from a gap, question, requirement, or decision | `# Action Items` |

Component descriptions summarize the component's scope. They do not store classified facts and must not duplicate item details.

### Classification decision tree

Apply these tests in order to each distinct proposition. Stop at the first matching terminal classification:

1. Is this explicitly supplied follow-up work with an actor or expected completion? Record an **Action Item**. Never infer one.
2. Is this newly obtained information that answers one identified Knowledge Gap? Record it only as that gap's **Finding**.
3. Is the agent asking the user what the request means, which scope is intended, or how to reconcile wording? Record an **Open Question**.
4. Does the user lack topic information that can only be obtained through research, experiment, data, or an external conversation? Record a **Knowledge Gap**.
5. Does the statement describe a choice among viable alternatives?
   - If no option is selected, record an **Decision** that is "Open".
   - If an option is selected, record a **Decision** that is "Decided".
   - If the choice is intentionally abandoned, record a **Decision** that is "Closed".
6. Does an external or imposed condition limit what can be done, independent of the solution selected? Record a **Constraint**.
7. Does a stakeholder require behavior, an outcome, conformance, or a prohibition? Record a **Requirement**.
8. Does the statement provide relevant context without satisfying another test? Record a **Note**.
9. Is there an ambiguity, contradictions, or vague statement? Then as an Open Question for clarification.
10. If no test matches, ask the user directly.

When one sentence contains multiple propositions that reach different terminals, split them into separate entries. Never choose a section from keywords alone; use the proposition's role.

### Required classification rationale

Whenever Phase 0 or Phase 1 reports a classification, provide enough decision information for another agent to audit the selection. For every recorded or changed entry, report:

- The source statement or a faithful short quote.
- The selected `kind -> section`.
- The decisive classification test that matched.
- The closest plausible competing kind and why it did not match.
- Any status selected and the evidence supporting that status.
- Any split into separate propositions.
- Any preserved hedge, uncertainty, or user-supplied rationale.

Do not report only `kind -> section`. Example:

```text
"We still need to pick a YAML parser" -> Decision -> Decisions
Reason: it names an unresolved choice among viable parser alternatives.
Status: Open because no parser was selected.
Not a Knowledge Gap: the missing information is which option the user will choose, not evidence that must be researched.
```

### Major classification boundaries

#### Requirement versus constraint

A Requirement states what stakeholders expect the solution to do. A Constraint states what the solution space cannot avoid because of an imposed reality. The user may communicate either; authorship alone does not determine the kind.

- Correct Requirement: "The export must include all active accounts." This defines required behavior.
- Correct Constraint: "The provider limits exports to 10,000 rows." This externally limits implementations.
- Incorrect: recording the provider's row limit as a Requirement merely because the user mentioned it.

#### Requirement versus decision

A Requirement defines the outcome that must hold. A Decision selects, or leaves open the selection of, a means or policy among alternatives. A decision can satisfy a requirement without replacing it.

- Requirement: "Users must receive an export within five minutes."
- Decision: "Figure out if we should use asynchronous exports rather than synchronous requests."
- Incorrect: duplicating "exports finish within five minutes" as both the Requirement and Decision.

#### Constraint versus decision

A Constraint exists regardless of which solution is selected. A Decision is a selectable response to that constraint. Record both when both propositions are present.

- Constraint: "iOS does not realize off-screen lazy cells until scrolling occurs."
- Decision: "The exact scrolling solution needs to account for the fact unrealized off-screen cells are unavailable. The possible options are..."
- Incorrect: merging the platform limitation and the chosen handling policy into one entry.

#### Decision versus open question

An Open Decision belongs to the user's topic: an alternative still needs selection. An Open Question belongs to the agent's clarification process: the agent needs the user to explain the request.

- Open Decision: "Pick the YAML parser library." The choice exists but is unresolved.
- Open Question: "Which YAML formats must the parser support?" The agent needs scope clarification.
- Incorrect: converting every unresolved agent question into an Open Decision.

#### Decision versus knowledge gap

A Decision asks which alternative will be selected. A Knowledge Gap asks for missing evidence that may inform that selection. Keep both when research informs a separate choice.

- Open Decision: "Choose polling or webhooks."
- Knowledge Gap: "The user does not know the provider's webhook delivery limits."
- Incorrect: recording "Which approach do you want?" as a Knowledge Gap; that is an Open Question to the user.

#### Knowledge gap versus open question

Classify by who lacks the information and how it can be resolved:

- Knowledge Gap: the **user** lacks topic information; resolution requires research, experiment, data, or an external conversation.
- Open Question: the **agent** lacks request clarity; resolution requires an answer from the user.
- Correct Knowledge Gap: "We do not know whether the external service supports bulk export; check its documentation."
- Correct Open Question: "When you say bulk export, do you require one archive or separate files?"
- Incorrect: copying the agent's bulk-export clarification into both sections.

An unanswered Open Question remains only an Open Question. Never create or convert it into a Knowledge Gap merely because it remains unanswered.

#### Knowledge gap versus finding

A Knowledge Gap states what topic information is missing. Its Findings body records only information later obtained that addresses that gap.

- Knowledge Gap: "The supported peak request rate is unknown."
- Finding: "Load testing measured 400 requests per second."
- Incorrect: restating "the peak request rate is unknown" in Findings.

#### Finding versus requirement

A Finding is evidence about the world; a Requirement is an expectation the solution must satisfy. Evidence may confirm, challenge, or motivate a Requirement, but must not repeat it.

- Requirement: "The service must support 300 requests per second."
- Finding: "Load testing measured a maximum of 400 requests per second."
- Incorrect Finding: "The service must support 300 requests per second."

#### Finding versus note

A Finding directly resolves or reduces a named Knowledge Gap and records obtained evidence. A Note preserves context that did not result from resolving that gap.

- Finding: "The provider documentation confirms a 10,000-row limit."
- Note: "Finance currently reviews exports monthly."
- Incorrect: recording the monthly review schedule as a Finding when no Knowledge Gap asked about it.

#### Note versus component description

A component description summarizes scope in 1-10 sentences. A Note preserves a distinct contextual fact within that scope.

- Description: "Define how analytics data is exported and reviewed."
- Note: "Finance currently reviews exports monthly."
- Incorrect: copying the monthly review fact into both locations.

#### Knowledge gap versus action item

A Knowledge Gap describes missing information. An Action Item describes explicitly supplied work that may obtain it. Neither substitutes for the other.

- Knowledge Gap: "The provider's sustained rate limit is unknown."
- Action Item: "Run a sustained-load test and document the rate limit."
- Incorrect: inventing that Action Item solely because the Knowledge Gap exists.

### Status and lifecycle rules

Decisions use the model statuses:

- `Open`: a choice among viable alternatives exists, but no alternative has been selected.
- `Decided`: the user selected an alternative. Preserve the selected option and any user-supplied rationale.
- `Closed`: the choice was intentionally abandoned or is no longer relevant. Do not use `Resolved`; it is not a Decision status.

Knowledge Gaps use the model statuses:

- `Open`: required topic information is still missing. Its `##### Findings` body may be empty or contain partial information.
- `Resolved`: Findings contain sufficient information to answer the gap. A non-empty Findings body is required.
- `Closed`: the gap was abandoned as irrelevant or no longer needed. Resolution evidence is not required.

Open Questions have no status field. Keep unanswered questions. After the user answers one, remove it and incorporate the answer into correctly classified standalone entries with enough context to be understood without the question-and-answer exchange.

Action Items use: 
  - `TODO`: The action item has not been started yet.
  - `In Progress`: The action item has been assigned and is being actively worked on.
  - `Done`: The action item has been completed, the acceptance criteria satisfied, and follow ups are resolved.
  - `Closed`: The action item was abandoned as irrelevant or no longer needed. Resolution evidence is not required.

Completing an Action Item associated with a Knowledge Gap must add its result to that gap's Findings and mark the gap `Resolved` when the result sufficiently answers it. `Done` alone is not evidence: record the resulting information in Findings.

### Findings structure and provenance

Each Knowledge Gap has exactly one `##### Findings` heading and one direct Markdown body. Do not create separately headed Finding items. The body may contain multiple paragraphs or bullets, but it remains one section.

If Action Items produced the Findings, cite every producing `ACTION-*` reference in the direct Findings body. Findings may cite multiple Action Items or none when no Action Item was needed. Do not invent provenance.

Correct:

```markdown
#### Knowledge Gap 1.A

**Status:** Resolved

The provider's sustained rate limit is unknown.

##### Findings

- `ACTION-2` measured a sustained limit of 400 requests per second. 
- `ACTION-3` confirmed the same limit in the provider documentation.
```

Invalid structures include component-level `### Findings`, peer `#### Findings`, and separate `###### Finding 1.A` items.

### Action Item relationships

Trigger Sources may reference a component (`COMP-1`) or a component item (`Requirement 1.A`, `Constraint 1.A`, `Decision 1.A`, `Knowledge Gap 1.A`, `Note 1.A`, or `Question 1.A`). Each source must resolve within the same plan. List every directly affected source by canonical reference and short description; multiple sources are allowed.

Action Items retain their context, acceptance criteria, trigger sources, assignees, and status. Do not infer an Action Item, assignee, acceptance criterion, or trigger source.

### No duplication

Store each proposition once according to its role. Related entries may reference one another, but must contribute different information. In particular:

- Do not copy a Requirement into Findings; Findings contain only newly obtained evidence.
- Do not copy an Open Question into Knowledge Gaps.
- Do not copy a Note into the component description.
- Do not copy a Constraint into a Decision; record the selectable response separately.
- Do not restate a Knowledge Gap in its Findings body.

When two candidate entries express the same proposition, keep the correctly classified entry and remove the duplicate. When they express different roles, retain both and make the relationship explicit.

### Never inflate a user statement

Record what the user said at the strength they said it.

- Do not convert "we need to work out how X should behave" into a decided outcome. Record the unresolved choice as an Open Decision.
- Do not convert "check what the other framework does" into a conclusion about what this solution will do.
- Do not invent a selected or rejected alternative. An unresolved choice may be an Open Decision, but its details must not claim that an option was chosen.
- Do not attach rationale the user did not give. If reasoning is inferred, label it `inferred, unconfirmed` and ask an Open Question.
- Preserve words such as *likely*, *probably*, *for now*, and *may*. A hedged choice is an Open Decision with a stated leaning, not a decided outcome.
- Never treat a fact the user merely agreed was accurate as post-research Findings.

## Phase 0 - Decomposition

1. Use only the brain dump supplied in the conversation.
2. Extract concrete concepts that need independent clarification. Keep user-declared concepts separate even if related.
3. Propose a numbered component list with 3-7 word descriptions and ask the user to confirm it.
4. After confirmation, run every supplied proposition through the classification decision tree. Classify requirements, constraints, decisions, knowledge gaps, findings, notes, open questions, and explicitly supplied action items.
5. Give every Knowledge Gap one empty `##### Findings` subsection unless the user already supplied information obtained after investigating that gap. Never invent Findings or duplicate an Open Question as a Knowledge Gap. Stub `Open Questions` if the agent has no clarification questions.
6. Write (`PLAN_FILE`) using the exact output format below.
7. Keep each distinct topic in its own requirement, constraint, or decision subsection. Never combine multiple topics in one item.
8. Preserve explicit user examples under the item they illustrate, including both `Good` and `Bad` examples when supplied.
9. Produce the Required Classification Rationale for every recorded entry. Quote the user's own words for Decisions. Separately report downgraded or omitted statements and explain which classification test they failed.
10. Stop. State that Phase 0 is complete and wait for explicit permission to enter Phase 1.

## Phase 1 - User Refinement

Enter only when the user expressly asks to proceed.

1. Re-read (`PLAN_FILE`), because the user may have changed it. This is explicit permission to read that plan file only, not the workspace or its references.
2. Critically assess each component for unclear scope, ambiguous wording, contradictions, user-owned Knowledge Gaps, duplicate propositions, and misclassified entries. Use Open Questions, not Knowledge Gaps, for clarification the agent needs from the user.
3. Add focused questions to that component's `Open Questions`. Every question must cite its trigger, such as exact wording, a contradiction, knowledge-gap finding, or note. Enclose quoted user phrasing in quotation marks inside the block quote.
4. Do not offer alternatives, recommend solutions, make choices, or lead the user toward a decision. Phase 1 refines known information only.
5. Run each answer through the classification decision tree and incorporate every distinct proposition into the correct section. Behavioral expectations become Requirements; imposed external limitations become Constraints; unresolved choices become Open Decisions; selected choices become Decided Decisions; user-owned missing topic information becomes Knowledge Gaps; obtained gap information becomes Findings; and contextual reminders become Notes. Preserve explicit examples under the affected item. Remove answered questions after incorporating their answers; retain only unanswered questions.
6. If answers create new ambiguity, add focused follow-up questions and report them.
7. Produce the Required Classification Rationale for every added, updated, moved, split, or removed entry. Quote Decisions and list downgrades and omissions with the failed classification test.
8. Do not proceed until all agent clarification questions are resolved and every component is well-defined.
9. Stop and wait for the user's explicit statement that they finished filling out the document and want Phase 2.

## Phase 2 - Ingest

Enter only after explicit permission.

Run (`SYNC_SCRIPT`) with (`PLAN_FILE`). It uploads the complete document, receives its reference, downloads canonical Markdown, and atomically overwrites the same file. Do not manually duplicate, parse, or rewrite plan content. Report the returned reference and stop.

```sh
"<SYNC_SCRIPT>" "<PLAN_FILE>"
```

## Output: (`PLAN_FILE`)

Create the file if missing; during refinement, update only content justified by the user. Use this structure for every component, retaining empty section headings when no entries exist:

```markdown
---
reference: New
title: <plan title>
description: <plan description>
tags:
  - <tag>
status: Draft
---

# Components

| Ref | Short Description |
|---|---|
| COMP-1 | <3-7 word description> |

## **COMP-1 - <short description>**

<1-10 sentence description>

### **Requirements**

#### Requirement 1.A

<details>

### **Constraints**

#### Constraint 1.A

<details>

### **Decisions**

#### Decision 1.A

**Status:** <Open|Decided|Closed>

<details>

### **Knowledge Gaps**

#### Knowledge Gap 1.A

**Status:** <Open|Resolved|Closed>

<details>

##### Findings

<direct post-research information produced for this knowledge gap>

### **Notes**

#### Note 1.A

<details>

### **Open Questions**

#### Question 1.A

> Regarding <specific trigger>, <focused question>?

# Action Items
```

Use the component number in every component-item reference (`2.A`, `3.A`, and so on). Always emit `# Action Items`, but do not fill or infer action items. Action items are follow-up work performed by users and may only be included when explicitly supplied. Valid plan statuses are `Draft`, `In Progress`, `Done`, and `Closed`. Valid Decision statuses are `Open`, `Decided`, and `Closed`; valid Knowledge Gap statuses are `Open`, `Resolved`, and `Closed`.

When an action item is explicitly supplied, use this structure:

```markdown
## **ACTION-1 - <short description>**

**Status:** <TODO|In Progress|Done|Closed>

<context explaining why it was created>

### Acceptance Criteria

#### Acceptance Criteria 1.A

<clearly measurable criterion>

### Trigger Sources

- COMP-1 - <short description>
- Knowledge Gap 1.A - <short description>

### Assignees

- <person>
```

List every affected triggering component or component item by canonical reference and short description. Every Trigger Source must resolve within the same plan. Multiple Trigger Sources are allowed. Use bullets for trigger sources and assignees.

## Common Mistakes

- Exploring the current repository because the brain dump mentions software.
- Reading a linked specification or attachment without explicit permission.
- Combining concepts the user explicitly separated.
- Combining distinct topics into one requirement, constraint, or decision.
- Turning requirements, constraints, notes, or acknowledgements into decisions.
- Duplicating an agent clarification question under both `Open Questions` and `Knowledge Gaps`.
- Creating a Knowledge Gap because the agent, rather than the user, lacks clarity about the request.
- Recording generic information as a finding instead of a note.
- Inventing action items or omitting the empty `# Action Items` heading.
- Filling stub sections with invented content.
- Continuing into refinement, research, ingestion, or implementation without the corresponding explicit phase permission.
