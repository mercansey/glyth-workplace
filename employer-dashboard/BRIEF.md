
You are a senior product designer, frontend engineer, backend engineer and systems architect.

Your task is to design and implement a new EMPLOYER DASHBOARD for the current application.

It must visually and structurally align with the UI that already exists in THIS repository.

Before changing anything:

1. inspect the current application
2. identify its existing design system
3. identify typography, spacing, radii, glass materials, navigation behaviour, motion patterns, page widths, card treatments and responsive rules
4. identify existing reusable primitives
5. reuse the CURRENT PROJECT’S components and design tokens where appropriate
6. do not introduce a visually separate enterprise design language

IMPORTANT:

If this is the Meta hackathon project, use ONLY code created within this hackathon repository.

Do NOT access, inspect, copy, reproduce or derive implementation details from any pre-existing Glyth production repository, schema, prompt library, backend or asset.

The employer dashboard must be an extension of the CURRENT hackathon application only.

OBJECTIVE

Create an employer-facing command centre that gives organisations a privacy-preserving understanding of:

* organisational readiness
* workload pressure
* engagement
* team capacity
* emerging organisational signals
* progress
* recommended interventions
* intervention outcomes

The dashboard should answer:

1. How is the organisation doing today?
2. Where is pressure increasing?
3. Which teams may need attention?
4. What is changing?
5. What can the organisation reasonably do about it?
6. Are previous interventions working?

It must NOT become an employee surveillance dashboard.

DESIGN PRINCIPLE

The consumer experience answers:

“What should I do today?”

The employer experience should answer:

“What does the organisation need today?”

Maintain the same underlying product philosophy:

CONTEXT
→ SIGNAL
→ INTERPRETATION
→ INTERVENTION
→ OUTCOME

PRIVACY PRINCIPLE

This is critical.

Employers must not receive unrestricted access to an individual’s personal Glyth context.

Do NOT expose individual:

* sleep data
* health measurements
* recovery scores
* medical information
* private conversations
* personal goals
* relationship information
* private AI interactions
* exact personal behavioural data

Employer intelligence should be:

* aggregated
* consent-aware
* privacy-preserving
* role-controlled
* purpose-limited

Default to team or organisational cohorts.

Implement a configurable minimum cohort threshold.

Recommended default:

MIN_COHORT_SIZE = 5

If fewer than the required number of participants contribute to a metric, suppress it.

Display:

“Not enough data to show this insight privately.”

Never infer missing individual data.

EMPLOYER NAVIGATION

Keep navigation extremely restrained.

Use THREE core destinations:

OVERVIEW
TEAMS
INSIGHTS

Conceptually:

[ Overview ] [ Teams ] [ Insights ]

Use the same Liquid Glass navigation system as the existing application.

Do NOT add a giant enterprise sidebar unless the existing responsive system genuinely requires one on desktop.

Secondary functions such as:

* organisation settings
* integrations
* permissions
* member management

should sit behind the organisation/profile control rather than becoming primary navigation.

OVERVIEW

Overview is the employer equivalent of Today.

This should be the default destination.

The entire page should communicate organisational state within approximately 10 seconds.

HERO STATE

Display a concise organisational state.

Example:

TEAM STATE

Stable

82% within normal capacity

Supporting text:

“Overall capacity remains stable, although workload pressure is increasing in Product.”

Avoid presenting one mysterious pseudo-scientific score as objective truth.

Instead combine several transparent signals.

Possible dimensions:

* capacity
* workload pressure
* engagement
* focus protection
* recovery pressure where appropriately aggregated and consented
* schedule density

TODAY

Show the organisation’s most important signals today.

Maximum 3–5.

Example:

Workload rising
Product workload is 18% above its recent baseline.

Focus fragmentation
Engineering has 23% more fragmented focus periods than its four-week baseline.

Capacity stable
Operations remains within normal capacity.

RECOMMENDED ACTIONS

Provide approximately three actionable recommendations.

Example:

Protect focus time

Product has experienced elevated meeting density for three consecutive days.

Suggested action:
Create a 2-hour meeting-free block tomorrow morning.

Actions:

[ Review ]
[ Apply ]

Another example:

Reduce meeting density

Engineering meeting load is significantly above baseline.

Suggested action:
Move two low-priority recurring meetings.

Recommendations must be explainable.

Never generate actions such as:

“Speak to employee X because their recovery is low.”

ORGANISATION TIMELINE

Include a lightweight view of major organisational moments.

Example:

09:00
Company stand-up

11:00
High meeting density

13:00
Focus window

15:00
Product review

17:00
Workload expected to fall

This is not intended to become a full calendar product.

It should show how organisational context affects recommendations.

TEAMS

Teams allows employers to understand aggregate team-level state.

Example cards:

Product
Stable
Capacity 74%
Workload ↑ 12%

Engineering
Watch
Capacity 62%
Meeting pressure ↑

Operations
Stable
Capacity 81%

Use existing visual primitives from the current application.

Avoid spreadsheet-like tables as the primary interface.

Selecting a team should open a detailed view or sheet.

TEAM DETAIL

A team detail view may contain:

Team status
Current capacity
Workload trend
Focus trend
Meeting density
Participation coverage
Relevant organisational signals
Current interventions
Recent outcomes

Example:

PRODUCT

Current state:
Elevated workload

Primary signal:
Workload 18% above 4-week baseline

Secondary signal:
Focus fragmentation +12%

Likely pressure:
Delivery deadline in 3 days

Suggested response:
Protect two focus windows over the next 48 hours.

INSIGHTS

Insights is the organisational intelligence layer.

Reuse the interaction philosophy of the consumer Insights screen.

Present:

KEY INSIGHT

Example:

“Meeting density is beginning to affect focus capacity.”

Supporting evidence:

Meetings ↑ 21%
Focus fragmentation ↑ 17%

Observed across:
Product + Engineering

Time range:
Past 7 days

SIGNAL RELATIONSHIPS

Create a simple visual relationship graph.

Example:

Meeting density ↑
↓
Focus fragmentation ↑
↓
Deep work availability ↓
↓
Delivery pressure ↑

Clearly distinguish:

OBSERVED

from:

INFERRED

Do not present model inference as established causality.

ORGANISATIONAL SIGNALS

Support signals such as:

* workload
* capacity
* meeting density
* focus fragmentation
* engagement
* schedule pressure
* intervention uptake
* goal progress
* organisational events

Health-derived information may only appear where:

1. users have explicitly consented
2. it is aggregated
3. cohort privacy thresholds are met
4. individual identification is impossible

INTERVENTIONS

Build a lightweight intervention system.

An intervention represents an employer-level action.

Examples:

Protect Focus Window
Reduce Meeting Density
Move Deadline
Adjust Team Capacity
Encourage Recovery Day
Schedule Team Check-In

Each intervention should have:

id
organisation_id
team_id optional
type
title
description
reason
evidence
created_at
status
created_by
started_at
completed_at
expected_outcome
observed_outcome

Statuses:

proposed
approved
active
completed
dismissed

INTERVENTION FLOW

Example:

Glyth identifies:

Meeting density ↑
+
Focus fragmentation ↑
+
Deadline approaching

Then proposes:

“Protect 10:00–12:00 tomorrow for Product.”

Employer selects:

Review

A Liquid Glass sheet opens:

PROTECT FOCUS

Why:
Meeting density has remained 18% above baseline for three days.

Affected team:
Product

Expected benefit:
Increase uninterrupted focus availability.

Actions:

[ Cancel ]
[ Approve ]

No intervention should execute automatically without appropriate permissions.

OUTCOMES

The dashboard should close the loop.

Do not merely recommend things forever.

Example:

INTERVENTION

Protected Product focus window

Before:
Focus fragmentation 31%

After:
Focus fragmentation 21%

Result:
Improved

Confidence:
Moderate

This establishes:

Signal
→ Intervention
→ Outcome

ORGANISATION PROGRESS

Although Progress is not a primary tab, include progress context where appropriate inside Overview and Insights.

Examples:

Last 30 days

Focus protection
+11%

Meeting pressure
-8%

Priority completion
+6%

Workload volatility
-4%

Show trends sparingly.

Avoid building an analytics warehouse UI.

ORGANISATION GOALS

Support organisational goals such as:

Improve focus capacity

Reduce unnecessary meeting load

Improve sustainable workload

Improve priority completion

Maintain healthy delivery pace

Schema:

organisation_goals

id
organisation_id
title
description
category
priority
target
current_value
status
created_at

Insights and recommendations should consider active organisation goals.

AI ARCHITECTURE

Use the application’s existing AI provider abstraction.

Employer reasoning should use a separate structured context.

Create:

EmployerReasoningContext

Example:

{
organisation,
active_goals,
organisation_baselines,
team_summaries,
important_signals,
current_interventions,
recent_outcomes,
upcoming_events,
constraints
}

Never send unnecessary personal user records into employer reasoning.

EMPLOYER CONTEXT COMPILER

Create:

EmployerContextCompiler

It should aggregate permitted signals before AI reasoning.

Flow:

Individual permitted signals
↓
privacy filtering
↓
cohort threshold
↓
aggregation
↓
baseline comparison
↓
EmployerReasoningContext
↓
reasoning provider

Privacy filtering must happen BEFORE model invocation.

STRUCTURED REASONING

Create a validated employer reasoning schema.

Example:

EmployerReasoningResult {
organisationState
observations
emergingSignals
affectedTeams
hypotheses
recommendations
proposedInterventions
explanation
confidence
}

Use Zod or the project’s existing validation library.

AI output must never directly mutate the database.

RULE ENGINE

Extend the deterministic rule layer.

Examples:

IF
team workload > baseline threshold

THEN
mark workload pressure

IF
meeting density elevated
AND
focus fragmentation elevated

THEN
recommend focus protection

IF
multiple teams exhibit workload pressure

THEN
surface organisation-level capacity signal

IF
cohort_size < privacy_threshold

THEN
suppress metric

Rules should work without AI.

AI enriches interpretation and recommendation quality.

ORGANISATION DATA MODEL

Extend the backend with the minimum clean schema required.

Consider:

organisations
organisation_members
organisation_roles
teams
team_memberships
organisation_goals
organisation_signals
team_signal_aggregates
employer_insights
interventions
intervention_outcomes
employer_ai_runs
data_consents

Use current project’s naming conventions.

Do not duplicate existing tables unnecessarily.

ORGANISATIONS

Suggested fields:

id
name
slug
created_at
updated_at

ORGANISATION MEMBERS

Suggested roles:

owner
admin
manager
viewer

Implement appropriate permissions.

TEAMS

Fields:

id
organisation_id
name
description
created_at

AGGREGATED SIGNALS

Example:

team_signal_aggregates

id
organisation_id
team_id
signal_type
period_start
period_end
value
baseline
change_percent
participant_count
suppressed
created_at

Individual-level source data must not be exposed through employer APIs.

CONSENT

Create a consent model.

Example:

data_consents

id
user_id
organisation_id
signal_category
allowed
granted_at
revoked_at

Users must be able to revoke consent.

Employer dashboards should update accordingly.

EMPLOYER API

Create or extend typed server operations for:

GET organisation overview

GET organisation teams

GET team summary

GET employer insights

GET interventions

POST review intervention

POST approve intervention

POST dismiss intervention

GET intervention outcome

GET organisation goals

GET privacy-safe aggregate signals

Do not allow employer clients to query raw employee personal tables.

SECURITY

Implement:

* Supabase RLS
* organisation membership validation
* role-based permissions
* server-side aggregation
* strict API validation
* cohort suppression
* consent enforcement

Managers should only access organisations/teams they have permission to view.

Do not rely on UI hiding as security.

DEMO DATA

Create synthetic employer demo data.

Example organisation:

NORTHSTAR

Teams:

Product
Engineering
Operations

Members:
Synthetic users only.

Seed enough members so privacy thresholds are satisfied.

Example organisation state:

Product
Workload +18%
Meeting density +13%
Capacity stable but declining

Engineering
Meeting density +24%
Focus fragmentation +17%
Capacity moderate

Operations
Stable

Create one strong hero insight:

“Meeting density is reducing focus capacity across Product and Engineering.”

Suggested intervention:

Protect a 2-hour focus window tomorrow morning.

EMPLOYER DEMO FLOW

A judge should be able to:

1. switch into Employer view
2. immediately understand organisational state
3. see one emerging signal
4. open Product
5. understand what changed
6. inspect supporting evidence
7. review a proposed intervention
8. approve the intervention
9. see expected impact
10. inspect a previously completed intervention and its outcome

Target:

60–90 seconds.

VIEW SWITCHING

If the current application supports consumer mode, create a clean account-context switcher.

Example:

MK
Personal

tap →

Personal
Northstar Organisation

Switching context should update navigation and available data.

Do not create two completely independent applications.

Use one coherent design system.

RESPONSIVE BEHAVIOUR

Mobile remains important.

However, employer dashboards should also make excellent use of desktop width.

Desktop:

Use a centered content canvas with restrained multi-column layouts where helpful.

Example:

Hero state
|
Signals | Recommendations

Avoid stretching cards across enormous displays.

Mobile:

Collapse naturally into a single vertical hierarchy.

Maintain Liquid Glass navigation.

CURRENT UI ALIGNMENT

This is mandatory.

Before implementing visual work, audit:

* current AppShell
* current navigation
* current glass primitive
* current typography
* current colour variables
* current background treatment
* current card surfaces
* current sheets/modals
* current animation utilities
* current responsive breakpoints

Reuse those primitives.

Do NOT create:

EmployerGlassCard
EmployerButton
EmployerNav

if equivalent generic components already exist.

Extend the existing system.

VISUAL PRINCIPLES

Maintain:

* dark graphite environment
* restrained monochrome presentation
* Liquid Glass materials
* subtle luminous borders
* depth through transparency
* generous whitespace
* controlled motion
* minimal visual noise
* strong typography
* premium product feel

Avoid:

* generic enterprise SaaS blue
* endless KPI cards
* dense admin tables
* giant left navigation
* bright graph palettes
* HR-software aesthetics
* traffic-light scoring everywhere

The dashboard should feel like the SAME PRODUCT viewed through an organisational lens.

MOTION

Use motion to explain changing state.

Examples:

When a new signal emerges:

signal value updates
↓
affected team subtly highlights
↓
insight appears
↓
recommended intervention becomes available

Keep motion restrained.

Respect reduced-motion settings.

COMPONENTS

Create/reuse approximately:

EmployerOverview
OrganisationState
OrganisationSignalList
EmployerRecommendation
OrganisationTimeline
TeamGrid
TeamCard
TeamDetailSheet
EmployerInsightHero
OrganisationSignalGraph
InterventionCard
InterventionReviewSheet
InterventionOutcome
OrganisationGoalSummary
PrivacyIndicator
OrganisationSwitcher

Reuse generic project components wherever possible.

PRIVACY UI

Make privacy visible rather than hidden in terms and conditions.

Example:

“Aggregated from 14 participants”

or:

“Individual data is never shown to employers.”

Where data is suppressed:

“Unavailable because fewer than 5 participants contributed.”

This should increase trust without cluttering the product.

EMPTY STATES

Handle:

no teams
no current signals
insufficient cohort size
no interventions
no active organisation goals
no insight available

Do not use fake alarming insights merely to avoid empty screens.

DEMO MODE

Extend existing demo mode.

The employer demo must work without real employee data.

Provide deterministic:

* organisation
* teams
* signals
* insight
* recommendation
* completed intervention
* intervention outcome

Demo reset must restore both personal and employer state.

TESTS

Add tests for:

* employer permissions
* organisation isolation
* team access
* consent enforcement
* cohort threshold suppression
* signal aggregation
* intervention lifecycle
* employer context compiler
* structured AI validation

Integration scenario:

meeting density rises
→ focus fragmentation rises
→ employer insight generated
→ focus intervention proposed
→ employer approves
→ intervention active

DEFINITION OF DONE

Employer dashboard is complete when:

1. organisation context can be selected
2. Overview loads real backend data
3. organisation state is understandable immediately
4. teams display privacy-safe aggregate state
5. team detail works
6. Insights are based on aggregate context
7. structured reasoning works
8. interventions can be reviewed
9. interventions can be approved/dismissed
10. outcomes can be displayed
11. privacy threshold suppression works
12. employer permissions are enforced server-side
13. UI visually matches the current application
14. mobile works
15. desktop works
16. demo data works reliably
17. tests pass

IMPLEMENTATION ORDER

PHASE 1
Audit current UI and architecture.

PHASE 2
Create organisation/team/backend data model.

PHASE 3
Implement RLS, permissions and consent.

PHASE 4
Build privacy-safe aggregation layer.

PHASE 5
Build Overview.

PHASE 6
Build Teams + Team Detail.

PHASE 7
Build Employer Context Compiler + reasoning.

PHASE 8
Build Insights.

PHASE 9
Build intervention workflow.

PHASE 10
Add outcomes, demo state, responsive polish and tests.

Do not stop at mockups.

Do not create static placeholder cards and call the feature complete.

Do not create frontend without backend support.

Do not create backend tables without wiring them into the UI.

Implement the employer experience as a genuine vertical slice.

FINAL REPORT

At completion return:

1. files changed
2. database migrations added
3. RLS policies added
4. APIs/server actions added
5. aggregation/privacy architecture
6. employer reasoning architecture
7. components/screens built
8. demo data created
9. tests added and results
10. remaining limitations
11. optional post-hackathon improvements

Most importantly:

Do not redesign the application.

Extend the existing UI language so the employer experience feels unmistakably part of the same product.