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

Classify every statement before choosing a section:

| Kind | Test | Section |
|---|---|---|
| Requirement | Stakeholder-set behavior or outcome the solution must satisfy | `Requirements` |
| Constraint | Unavoidable platform, integration, physical, compatibility, or imposed limitation | `Constraints` |
| Decision | A user choice among viable alternatives with a real rejected alternative | `Decisions` |
| Knowledge gap | Missing information requiring research, experiment, data, or conversation before choices can be made | `Knowledge Gaps` |
| Note | Context that informs judgment but neither obliges nor chooses | `Notes` |

Before recording a decision, ask all four gates:

1. Could the opposite reasonably have been chosen? If not, record a constraint or note.
2. Can a real rejected alternative be named from the user's information? If not, do not call it a decision.
3. Did the user choose it, rather than merely acknowledge a fact?
4. Would it be revisited by choosing differently, rather than only because the world changed?

Separate a constraint from any choice made in response to it. Requirements express stakeholder expectations; constraints arise from unavoidable external or integration realities. Acknowledging a fact is not choosing it.

## Constraint versus decision
 
 - "iOS requires scrolling to realize lazy cells" → **constraint**. Nobody chose
   it; no alternative exists.
 - "V2 plans on the expectation that off-screen cells do not exist" → **decision**
   derived from that constraint. The alternative, pretending off-screen rows are
   addressable, was available and rejected.
 
 Split a constraint and the decision it forces into two entries. Never merge
 them into one, because the constraint outlives any decision built on it.
 
 - "V1 must keep working; a breaking change is not permitted" → **constraint**.
   It was imposed on the work, not selected by it.
 - "V2 is a fresh module that does not import V1" → **decision** made to satisfy
   that constraint.
 
 ### Constraint versus requirement
 
Requirements are expectations for intended behavior while constraints are
compatability limitations. Both restrict the possible decisions that can be
made, the main difference is where they come from.
 
 - Requirements come from the user. They are defined behaviors, restrictions on behaviors, or expected conformance.
 - Constraints come from research and integrations. Constraints can be added by the user or from research, but they are based around system integrations, framework limitations, or as side-effects from other requirements/constraints.
 
Requirements should be information such as:
 - Expected APIs
 - component behavior
 - Expected outcomes
 
Constraints should be information such as:
 - Platform limitations
 - Framework quirks
 - Restrictions caused by external factors
 
### Knowledge gaps
 
Knowledge gaps are for describing where there are known gaps in the current information about the component. This are meant to capture required follow up research that will effect what decisions are made. Knowledge gaps should mostly be provided by the user, but may come from the agent during `Phase 1 - User Refinement`.
 
These should include information like:
 - Is option A or option B more performant
 - Is there a framework to perform functionality X
 - How are teams using this today?
 - What is our functional capacity under the current infrastructure constraints?
 - How many teams will be affected by a change to the API contract?
 
Knowledge gaps are often related to decisions, the resolution of the knowledge gaps may directly affect which options are selected. The point of knowledge gaps are to help produce the follow up action components, and may only be closed out from real data, research, experiments, or conversations.
 
### Never inflate a user statement
 
Record what the user said, at the strength they said it.
 - Do not convert "we need to work out how X should behave" into a decision
   about how X behaves. That is an **open decision**, plus a follow-up action.
 - Do not convert "check what the other framework does" into a conclusion about
   what ours will do.
 - Do not invent a rejected alternative to justify promoting a statement to a
   decision. If you cannot name one the user actually ruled out, there is no
   decision yet.
 - Do not attach a `Why` the user did not give. If you infer the reasoning, mark
   it `inferred, unconfirmed` and ask.
 - Words like *likely*, *probably*, *for now*, and *may* are hedges. Preserve
   them verbatim. A hedged statement is an open decision with a stated leaning,
   not a decision.
 
Use `**Confirmed by user:** yes` only when the user confirmed a **choice**.
Never treat a fact the user merely agreed was accurate as a post-research knowledge-gap finding.

## Phase 0 - Decomposition

1. Use only the brain dump supplied in the conversation.
2. Extract concrete concepts that need independent clarification. Keep user-declared concepts separate even if related.
3. Propose a numbered component list with 3-7 word descriptions and ask the user to confirm it.
4. After confirmation, classify the supplied statements into requirements, constraints, decisions, knowledge gaps, and notes.
5. Give every knowledge gap an empty `Findings` subsection unless the user already supplied post-research information for that gap. Stub `Open Questions` if the user supplied none. Do not invent content merely to fill a section.
6. Write (`PLAN_FILE`) using the exact output format below.
7. Keep each distinct topic in its own requirement, constraint, or decision subsection. Never combine multiple topics in one item.
8. Preserve explicit user examples under the item they illustrate, including both `Good` and `Bad` examples when supplied.
9. Report every recorded entry as `kind -> section`. Quote the user's own words for decisions. Separately report downgraded or omitted statements, and flag anything that lacked a rejected alternative.
10. Stop. State that Phase 0 is complete and wait for explicit permission to enter Phase 1.

## Phase 1 - User Refinement

Enter only when the user expressly asks to proceed.

1. Re-read (`PLAN_FILE`), because the user may have changed it. This is explicit permission to read that plan file only, not the workspace or its references.
2. Critically assess each component for unclear scope, ambiguous wording, contradictions, and knowledge gaps.
3. Add focused questions to that component's `Open Questions`. Every question must cite its trigger, such as exact wording, a contradiction, knowledge-gap finding, or note. Enclose quoted user phrasing in quotation marks inside the block quote.
4. Do not offer alternatives, recommend solutions, make choices, or lead the user toward a decision. Phase 1 refines known information only.
5. Incorporate answers naturally into the correctly classified sections. Behavioral clarifications become requirements; external process or tooling restrictions become constraints; statements that something remains undecided become decisions; and statements to keep something in mind become notes. Preserve explicit examples under the affected item. Mark answered questions answered, unanswered questions open, and irrelevant questions closed.
6. If answers create new ambiguity, add focused follow-up questions and report them.
7. For every answer folded in, report `kind -> section`, quote decisions, and list downgrades, omissions, and statements lacking rejected alternatives.
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

#### Findings

##### Finding 1.A.1

<post-research information produced by an action item for this knowledge gap>

### **Notes**

#### Note 1.A

<details>

### **Open Questions**

#### Question 1.A

> Regarding <specific trigger>, <focused question>?

# Action Items
```

Use the component number in every component-item reference (`2.A`, `3.A`, and so on). Always emit `# Action Items`, but do not fill or infer action items. Action items are follow-up work performed by users and may only be included when explicitly supplied. Valid plan statuses are `Draft`, `In Progress`, `Done`, and `Closed`.

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

List every affected triggering item by reference and short description. Use bullets for trigger sources and assignees.

## Common Mistakes

- Exploring the current repository because the brain dump mentions software.
- Reading a linked specification or attachment without explicit permission.
- Combining concepts the user explicitly separated.
- Combining distinct topics into one requirement, constraint, or decision.
- Turning requirements, constraints, notes, or acknowledgements into decisions.
- Recording generic information as a finding instead of a note.
- Inventing action items or omitting the empty `# Action Items` heading.
- Filling stub sections with invented content.
- Continuing into refinement, research, ingestion, or implementation without the corresponding explicit phase permission.
