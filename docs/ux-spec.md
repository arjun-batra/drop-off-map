# UX Spec: DropSpot

Status: FINAL (pending map-view cost confirmation, §6.7) — ready for Gate 3 review alongside `docs/design.md`. **Addendum 2026-07-12**: §4.2a, §5a, §6.6a, and the excluded-candidate notice in §6.4 add the FR-018 ("avoid tolls" checkbox) and FR-019 (toll re-entry confirmation) flow, per the 2026-07-12 change request. This addendum is **DRAFT — pending Gate 3 approval alongside `docs/design.md`'s INC-10..14 plan**, consistent with that document's own status line; it is not yet cleared for build. One item (§9, round-cap edge case) is flagged for tech-lead/user confirmation before INC-14 build, not decided unilaterally here. FR-020 (highway exclusion) requires no UI (silent server-side exclusion, no user-facing state) and is not addressed further in this spec. FR-021 (transit stop/line/direction display on candidate cards) and FR-022 (Google Maps JS API rendering, replacing the Leaflet mockup in §6.7) are **not yet addressed by this spec** and remain a separate designer pass — flagged in §9 so this is a tracked gap, not a silent omission.
Source: `docs/idea-brief.md`, `docs/requirements.md` (both approved).
Owner: designer. Do not edit outside this agent.

## 0.0 Product Name

The user asked for a creative, catchy product name to replace the "Drop-off Point Finder" placeholder. Shortlist considered:

| Name | Rationale |
|---|---|
| **DropSpot** (selected) | Short, friendly, plain-language pairing of "drop [off]" + "spot" (the point along the route). Reads naturally in UI copy ("Find your DropSpot"). Easy to say, easy to brand, no jargon. |
| CurbWise | Clever wordplay (curb + wise/smart) but "curb" skews toward curbside pickup/rideshare branding and is less immediately self-explanatory. |
| MidPoint Transit | Descriptive but generic/dry, sounds like a transit agency rather than a lightweight consumer tool. |
| Handoff | Evocative of the driver-to-transit handoff concept, but ambiguous outside context (reads as a general "handoff" tool, not location-specific). |

**DropSpot** is used throughout this spec in place of the placeholder. Final naming/branding sign-off (logo, domain, trademark check) is outside this spec's scope and should be confirmed with the user before deploy.

## 0. Design Principles

1. **Mobile-first, single-column, single-flow.** No navigation menu, no accounts, no dashboard — this is a linear tool: enter trip → wait → read results. Every screen in this spec is a step in that one flow.
2. **Say the estimate is an estimate, loudly.** The safety/legality disclaimer (FR-014) is a first-class, persistent UI element, not fine print. It is never rendered as a dismiss-once toast or a collapsed tooltip.
3. **Never fail silently.** Every place the system could show nothing (bad address, out of area, no transit, provider timeout) has an explicit, specific message. Generic "Something went wrong" is the last resort, not the default.
4. **Fast-feeling, not just fast.** Given the 5s target (NFR-004) with live external calls, the loading state must communicate real progress/context so 3-5 seconds does not feel stalled.

## 1. Screen Inventory (mapped to FRs)

| # | Screen | Shown when | FR/NFR coverage |
|---|---|---|---|
| 0 | Password Gate | `APP_MODE = paid_tier` | FR-016, FR-017 |
| 1 | Input Screen | Always, first screen after gate (or app entry in free-tier mode) | FR-001, FR-002, FR-003, FR-004, FR-015, FR-018 |
| 2 | Loading State | After valid submit, while awaiting results; also reused (with swapped copy) while re-computing after a toll re-entry answer | NFR-004, FR-019 |
| 2a | Toll Road Check (conditional) | Only when `avoidTolls === false` and the search response flags one or more final candidates with `needsTollReentryConfirmation: true` (§5a) | FR-019 |
| 3 | Results Screen | On successful computation | FR-005–FR-014, FR-019 (excluded-candidate notice) |
| 4 | Edge/Error States | Out-of-radius, unresolvable address, no viable route, no toll-free route, system failure | FR-003, FR-004, FR-011, FR-012, FR-018 |

Flow: `[Password Gate]` (conditional) → `Input` → `Loading` → `[Toll Road Check]` (conditional, may repeat once — §5a) → `Results` **or** `Error state` (with a path back to `Input`).

There is no persisted state between sessions (NFR-003): the "back to edit" affordance only preserves values within the current in-memory page session, not across a reload or a new visit.

---

## 2. Visual System (tokens)

All values below are named tokens. Dev implements these in the theme/config, not as inline literals in components.

### 2.1 Color tokens

| Token | Purpose | Example value |
|---|---|---|
| `color-bg-page` | App background | `#F7F8FA` |
| `color-bg-surface` | Card / input background | `#FFFFFF` |
| `color-bg-surface-raised` | Rank-1 ("best option") card background | `#F0F7FF` |
| `color-border-default` | Default input/card border | `#D8DCE1` |
| `color-border-focus` | Focused input border | `color-brand-primary` |
| `color-text-primary` | Main text | `#1A1D21` |
| `color-text-secondary` | Helper/meta text | `#5B6470` |
| `color-text-disabled` | Disabled text | `#A2A9B3` |
| `color-brand-primary` | CTA buttons, links, active/rank-1 accents | `#1E6FD9` |
| `color-brand-primary-hover` | Hover/pressed state of primary | `#175BB0` |
| `color-on-brand-primary` | Text/icons on primary-colored surfaces | `#FFFFFF` |
| `color-warning-bg` | Disclaimer banner, fallback-warning banner | `#FFF8E6` |
| `color-warning-border` | Border for warning surfaces | `#F0B429` |
| `color-warning-text` | Text on warning surfaces | `#7A5B00` |
| `color-danger-bg` | Field-error backgrounds, failure screens | `#FDECEC` |
| `color-danger-border` | Field-error borders | `#D93025` |
| `color-danger-text` | Error copy | `#B3261E` |
| `color-focus-ring` | Keyboard focus outline (all interactive elements) | `#1E6FD9` @ 40% opacity, 2px |

### 2.2 Spacing scale

| Token | Value |
|---|---|
| `space-2xs` | 2px |
| `space-xs` | 4px |
| `space-sm` | 8px |
| `space-md` | 16px |
| `space-lg` | 24px |
| `space-xl` | 32px |
| `space-2xl` | 48px |

### 2.3 Type scale

Minimum 16px for any text inside a form input, to prevent iOS auto-zoom on focus.

| Token | Size/Line-height | Weight | Usage |
|---|---|---|---|
| `type-h1` | 22/28 | 700 | App title |
| `type-h2` | 18/24 | 600 | Section headers, candidate address per card |
| `type-body` | 16/24 | 400 | Default copy, input text |
| `type-body-strong` | 16/24 | 600 | Disclaimer text, key numbers (totals) |
| `type-body-small` | 14/20 | 400 | Helper text, secondary breakdown rows |
| `type-label` | 12/16, uppercase, +0.04em tracking | 600 | Field labels, rank badges |
| `type-caption` | 12/16 | 400 | Least-emphasis meta text only (never used for the disclaimer) |

### 2.4 Shape & elevation

| Token | Value | Usage |
|---|---|---|
| `radius-sm` | 4px | Inputs, field-error boxes |
| `radius-md` | 8px | Cards, buttons |
| `radius-full` | 999px | Rank badges, pills |
| `shadow-sm` | `0 1px 2px rgba(0,0,0,0.08)` | Resting cards |
| `shadow-md` | `0 2px 8px rgba(0,0,0,0.12)` | Sticky banner once page has scrolled |

### 2.5 Layout

- Mobile default: single column, full-bleed sections, `space-md` side padding.
- `>= 600px` viewport: content centers in a `container-max-width: 480px` column (this stays a single linear flow — no multi-column grid is introduced at wider viewports).
- Minimum tap target: 44x44px for all buttons/icons (geolocation buttons, badges are not tappable so exempt).

---

## 3. Screen 0 — Password Gate (paid-tier mode only)

Shown only when `APP_MODE = paid_tier`. Fully replaces the app; nothing behind it is reachable, including error/help content — this is a hard block per FR-016.

```
┌───────────────────────────────────┐
│                                     │
│              🔒                     │
│                                     │
│             DropSpot                │
│                                     │
│  This app requires a password       │
│  to continue.                       │
│                                     │
│  PASSWORD                           │
│  ┌───────────────────────────────┐ │
│  │ ••••••••••••          [Show]  │ │
│  └───────────────────────────────┘ │
│                                     │
│  ┌───────────────────────────────┐ │
│  │           Continue              │ │
│  └───────────────────────────────┘ │
│                                     │
└───────────────────────────────────┘
```

**Components**
- Title: `type-h1`. Body copy: `type-body`, `color-text-secondary`.
- Password `<input type="password">`, with a "Show"/"Hide" toggle (accessibility + reduces mistyping on mobile). 16px min font size.
- Primary button "Continue" — full width, `color-brand-primary` background, disabled (visually `color-text-disabled` state) while the field is empty.
- Enter key submits the form; no separate keypress handling needed beyond standard form submit.

**States**
- Default/empty: button disabled.
- Submitting: button shows an inline spinner + label "Checking…", field disabled during the check.
- Incorrect password: field gets `color-danger-border`; inline text below field, `type-body-small`, `color-danger-text`:
  > "Incorrect password. Please try again."
  Field is cleared on error (do not leave a wrong password sitting in the field) and refocused.
- Success: navigate to Input Screen (Screen 1).

**Persistence note (flag for tech-lead/dev):** once the correct password is accepted, the user should not be re-prompted on every subsequent action within the same browser session (e.g., navigating back from Results to Input). This can be a client-side session flag only (e.g., `sessionStorage`) — it does not conflict with the app's stateless/no-accounts requirement (NFR-002/NFR-003) since nothing is persisted server-side or across browser sessions. Exact mechanism is a dev/tech-lead implementation choice.

**Resolved:** no lockout/throttling is required for the password gate. A wrong attempt simply shows the inline error above and lets the user try again immediately, with no attempt counter, delay, or lockout logic of any kind.

---

## 4. Screen 1 — Input Screen

Single form, four fields, in this order. All fields required before "Find drop-off points" is enabled.

```
┌───────────────────────────────────┐
│  DropSpot                          │  type-h1
│  Find the best spot along your      │  type-body-small, color-text-secondary
│  route to drop someone off for      │
│  transit.                           │
├───────────────────────────────────┤
│  YOUR START POINT                   │  type-label
│  ┌───────────────────────────────┐ │
│  │ 🔍 Enter an address…            │ │  text input w/ autocomplete
│  └───────────────────────────────┘ │
│  📍 Use my current location          │  secondary/text button
│                                     │
│  YOUR DESTINATION                   │
│  ┌───────────────────────────────┐ │
│  │ 🔍 Enter an address…            │ │
│  └───────────────────────────────┘ │
│  📍 Use my current location          │
│                                     │
│  PASSENGER'S DESTINATION             │
│  ┌───────────────────────────────┐ │
│  │ 🔍 Enter an address…            │ │
│  └───────────────────────────────┘ │
│  📍 Use my current location          │
│                                     │
│  MAX ACCEPTABLE DETOUR (MINUTES)     │
│  ┌───────────────────────────────┐ │
│  │ e.g. 10                         │ │  numeric input
│  └───────────────────────────────┘ │
│                                     │
│  ☐ Avoid tolls                      │  checkbox, unchecked by default
│                                     │
│  ┌───────────────────────────────┐ │
│  │      Find drop-off points        │ │  primary CTA, disabled until valid
│  └───────────────────────────────┘ │
└───────────────────────────────────┘
```

On mobile, the primary CTA is sticky-positioned at the bottom of the viewport once the user has scrolled past it, so it's always reachable without scrolling back up (common mobile form pattern) — implementation detail for dev, not a new screen.

### 4.1 Location fields (x3: start, driver destination, passenger destination) — FR-001, FR-015

Each of the three fields is identical in behavior:

- **Input control:** text field with autocomplete/geocoder suggestions appearing as a dropdown list below the field as the user types (min 3 characters before querying, standard debounce — exact ms is a dev/tech-lead implementation detail, not specified here). Keyboard-navigable (up/down/enter), ARIA combobox pattern.
- **"Use my current location" control:** a secondary (text-style, not filled) button directly under each field, icon + label. Tapping it:
  1. Triggers the browser's native geolocation permission prompt (first use only, per browser behavior).
  2. On success: reverse-geocodes the coordinates and populates the field with a human-readable address, plus a small "current location" badge/pill next to the field so the user knows why it auto-filled.
  3. On denial or failure: see States below — never leaves the field silently empty with no explanation.

**Field states:**

| State | Visual | Copy |
|---|---|---|
| Empty (default) | `color-border-default`, placeholder "Enter an address…" | — |
| Focused, typing | `color-border-focus`, suggestion dropdown open | — |
| Resolved/valid | Border returns to default, small check icon at right of field, field shows the resolved formatted address (not necessarily verbatim what the user typed) | — |
| Geolocation in progress | Field shows a small inline spinner in place of the check icon | "Finding your location…" (`type-body-small`, `color-text-secondary`, under the field) |
| Geolocation denied/unavailable | Field remains editable, unchanged border | Inline `type-body-small`, `color-text-secondary`, under the field: "Location access wasn't available. Please type an address instead." |
| Unresolvable address (FR-003) | `color-danger-border` | Inline `type-body-small`, `color-danger-text`, under the field: "We couldn't find that address. Try a more specific address or a nearby cross street." |
| Lookup failed (provider/network error) | `color-danger-border` | Inline `type-body-small`, `color-danger-text`, under the field: "We couldn't check that address right now. Please try again." |
| Outside service area (FR-004) | `color-danger-border` | Inline `type-body-small`, `color-danger-text`, under the field: "This location is outside our service area (within `GEOGRAPHIC_RADIUS_KM` of `GEOGRAPHIC_CENTER`). We don't support this area yet." — copy renders with the actual configured radius/center substituted, e.g. "within 200 km of Toronto." |

**"Lookup failed" vs. "Unresolvable address" — these are deliberately distinct states, not variants of the same copy:**
- *Unresolvable address* means the lookup completed and the provider affirmatively could not match the typed text to any address (a data/input problem — the user's text needs to change).
- *Lookup failed* means the lookup itself never completed — a network error or a provider-side failure (timeout, outage, malformed response) — so nothing has been confirmed or denied about the address itself. This is a mechanism failure, not a judgment about what the user typed, so the copy must not suggest the address is bad and must invite a retry instead of a rewrite.
- This state applies identically to all three location fields (start, driver's destination, passenger's destination) — it is a property of the geocoding lookup mechanism shared by all three (§4.1 preamble), not of any one field's business logic (e.g., the radius check, which only applies to two of the three fields, is unrelated to this state).
- Behavior: field border and icon match the other danger states above; the field remains editable. Retyping or re-selecting a suggestion re-triggers a new lookup attempt (same retry path as any other field edit — no separate "Retry" button is introduced). "Use my current location" retries the same way if the failure occurred during reverse geocoding.
- This state must never be silently swallowed into a generic/blank field or into the "Unresolvable address" copy — doing so would misrepresent a mechanism failure as an address problem and violates the "never fail silently" principle (§0).

Validation timing: address resolution and radius checks run as soon as a suggestion is selected or "use current location" completes — not deferred to submit — so the user sees the specific field's problem immediately, before trying to submit.

### 4.2 Max acceptable detour field — FR-002

- Numeric input, unit "minutes" shown as a suffix label inside/next to the field (e.g., "10 min").
- Required. Client-side validation:
  - Empty on submit attempt → inline error, `color-danger-text`: "Enter a maximum detour time in minutes."
  - Non-numeric or ≤ 0 → inline error: "Enter a number greater than 0."
  - **Resolved:** no upper bound/sanity-check ceiling is enforced. Any positive number is accepted as entered — a plain numeric input with no cap.

### 4.2a Avoid tolls checkbox — FR-018 (2026-07-12 addition)

- Standard checkbox, label "Avoid tolls," `type-body`. Unchecked by default (matches FR-018's stated default), no persistence across sessions (NFR-003/DEC precedent — same treatment as every other input on this screen).
- No helper caption is needed under the checkbox in the common case — the checkbox is self-explanatory. Do **not** attempt to explain the toll re-entry question (§5a) here; that question, when it applies, is self-contained and explains itself at the point it's actually asked. Front-loading that explanation on the Input Screen for every user, regardless of whether it will ever apply to their trip, would violate this spec's "fast-feeling, low-friction, no speculative screens" posture (§0 principle 1) — most sessions will never see §5a at all.
- Effect on downstream flow (for designer/dev orientation, not user-facing copy): when checked, every driving-route calculation excludes toll roads entirely (FR-018) and the toll re-entry question (§5a) never appears, since no toll segment can exist to exit/re-enter (FR-019's own scope). When unchecked (default), driving routes may use tolls, and §5a's confirmation step appears if — and only if — the computed results actually contain a re-entry pattern.
- **New empty-result outcome when checked (FR-018/OQ-9):** if no toll-free route exists at all between the given start/destination, the Results screen renders the "No toll-free route found" state instead of any cards — see §6.6a.

### 4.3 Primary CTA — "Find drop-off points"

- Disabled (visual: `color-text-disabled` on `color-bg-page`-tinted background, no pointer) until all three locations are resolved and the detour field is valid.
- On tap with invalid fields (e.g., user somehow reaches an invalid state, or a resolved field became invalid): scroll to and focus the first invalid field, show its inline error.
- On tap with all valid: transitions to Screen 2 (Loading).

---

## 5. Screen 2 — Loading State

Replaces the form (not a modal over it) once submission starts. Full-viewport, centered content.

```
┌───────────────────────────────────┐
│                                     │
│                                     │
│              (spinner)              │
│                                     │
│   Finding the best drop-off          │
│   points along your route…           │
│                                     │
│   Checking live traffic and           │
│   transit data.                      │
│                                     │
│                                     │
│              Cancel                  │  text link, returns to Input
│                                     │
└───────────────────────────────────┘
```

- Spinner/progress indicator: indeterminate (no percentage — the system cannot know provider latency in advance).
- Primary line: `type-h2`. Secondary line: `type-body-small`, `color-text-secondary`.
- "Cancel" text link: `type-body`, `color-brand-primary`. Returns the user to the Input screen with their previously entered values still populated (in-memory only; not persisted).
- If the wait extends meaningfully beyond the target in NFR-004 (exact threshold to coordinate with tech-lead's chosen timeout/config — not specified in requirements, flagged in Open Questions), swap the secondary line to:
  > "Still working — this is taking a little longer than usual."
  Do not show an error until the request actually fails or times out server-side; a slow-but-succeeding request should never show a false error.

**5.1 Reuse for toll re-entry re-computation (2026-07-12, FR-019):** this same screen (same layout, same spinner, same "Cancel" affordance) is reused — not a new screen — after the user answers §5a's Toll Road Check and taps "Continue," while `POST /api/drop-off-search/confirm-toll-reentry` runs. Only the copy differs:
```
   Updating your results…

   Removing the option(s) you didn't
   want and re-checking what's left.
```
"Cancel" here returns to the Input screen exactly as it does on the initial search (not back to the Toll Road Check screen — cancelling a search is a full restart, consistent with the rest of this spec's linear-flow principle, §0.1). The same "taking longer than usual" copy swap applies if this re-computation also runs long.

---

## 5a. Screen 2a — Toll Road Check (conditional, FR-019, 2026-07-12 addition)

### 5a.0 Where this sits in the flow, and why

Tech-lead's design (`docs/design.md` §4.6/§1.4) deliberately left the interaction model as an open design call, recommending a stateless "batch-ask-once, one bounded confirm round-trip" shape for cost/latency reasons, and flagged three placement options for designer to choose among: (1) a general preference asked upfront on the Input Screen, (2) a bounded interstitial step between Loading and Results, or (3) an inline per-candidate prompt on the Results screen itself.

**Decision: option (2) — a conditional interstitial screen between Loading and Results, shown only when it is actually needed.** Rationale:
- The question is a fact about a *specific computed route* ("does this candidate's actual driven route exit and re-enter a toll highway"), not a general preference the user could meaningfully answer before any computation exists — asking it upfront on the Input Screen (option 1) would mean asking speculatively, every session, regardless of whether any candidate ever has this pattern. Per §0 principle 1 (no speculative screens) and this project's general "never ask a question whose answer doesn't yet have a real basis" posture, this is worse UX than asking only once the pattern is confirmed to exist.
- An inline per-candidate prompt directly on the Results screen (option 3) would mean showing the user a set of cards that could still change (some might vanish once answered "no"), which risks the results screen reading as unstable/half-finished, and doesn't map cleanly onto the stateless "recompute via a second endpoint call" mechanism tech-lead designed (§5.2's `confirm-toll-reentry` — a full response replaces the prior one; it isn't a targeted patch to a subset of already-rendered cards).
- A dedicated interstitial, shown **only when at least one final candidate is actually flagged** (`needsTollReentryConfirmation: true` on any candidate in the search response), keeps the common case (most trips, most regions, never involve this pattern at all) completely unaffected — zero added screens, zero added friction — while giving the rarer affected case a clear, single-purpose moment to decide, before results are shown. This mirrors this spec's existing precedent of conditional screens (Password Gate, Fallback banner, empty states) that only render when their triggering condition is actually true.

### 5a.1 Batch vs. sequential, and once-for-the-trip vs. per-candidate — designer's call

**Decision: present all currently-flagged candidates together on one screen (batched), but require an explicit answer per candidate, not one blanket answer for the whole trip.**

Rationale: the re-entry pattern is a property of each candidate's own driven route (`start → candidate → driverDestination`), computed independently per candidate (`docs/design.md` §4.6 step 1) — different candidates can have different patterns, or no pattern at all, even within the same result set. Collapsing this to a single "yes/no for the whole trip" question would either (a) force acceptance of a pattern the user might reject for one specific candidate just because they accepted it for another, or (b) force rejection of a candidate that's actually fine, just because a *different* candidate in the same batch has the same or a different toll issue. Per-candidate answers, batched into a single screen (not sequential one-at-a-time screens), give the user precise control while still keeping this to exactly one screen and one round-trip in the common case — matching tech-lead's stateless, cost-bounded design intent (`docs/design.md` §4.6, `confirm-toll-reentry`'s `rejectedCandidateLocations: Array<...>` request shape already supports exactly this granularity).

### 5a.2 Mockup — first round (initial flagged candidates)

```
┌───────────────────────────────────┐
│  ← Edit search                      │
│                                     │
│  One quick question about            │  type-h2
│  toll roads                         │
│                                     │
│  One or more of your route options   │  type-body, color-text-secondary
│  use a toll highway, but get off it   │
│  and back on again during the trip —  │
│  meaning you'd pay the toll twice      │
│  instead of once. Let us know if       │
│  that's okay for each option below.    │
│                                     │
│ ┌─ Oak Ave & Main St ─────────────┐│
│ │ Uses Highway 407 — exits and       ││  type-body-small,
│ │ re-enters it during this trip.      ││  color-text-secondary
│ │                                     ││
│ │ ┌───────────────┐ ┌──────────────┐││
│ │ │ ✓ Yes, that's  │ │ ✕ No, don't   │││  two equal-weight
│ │ │   fine          │ │   include it  │││  toggle buttons
│ │ └───────────────┘ └──────────────┘││
│ └────────────────────────────────┘│
│                                     │
│ ┌─ Elm St & 5th Ave ──────────────┐│
│ │  …same structure, own answer…      ││
│ └────────────────────────────────┘│
│                                     │
│  ┌───────────────────────────────┐ │
│  │            Continue              │ │  primary CTA
│  └───────────────────────────────┘ │
└───────────────────────────────────┘
```

**Components**
- "← Edit search": identical affordance/behavior to the Results screen's (§6.3) — returns to Input with all four values preserved. Choosing to edit the search here is a legitimate exit from this screen (e.g., the user decides they'd rather just check "Avoid tolls" instead of answering).
- Title: `type-h2`. Explainer paragraph: `type-body`, `color-text-secondary`. Copy deliberately avoids jargon ("toll road exit/re-entry," "re-entry pattern") in favor of a plain restatement of the real-world consequence (paying the toll twice instead of once) — consistent with §0's "never fail silently, never speak in jargon a driver mid-trip would have to decode" posture.
- One card per flagged candidate, in the **same rank/order position** the candidate held in the search response (so a user who glanced at "candidate near Oak Ave" mentally maps it consistently, even though full Results aren't shown yet). Card header reuses the same reverse-geocoded label the Results card will use (§6.4) — same visual vocabulary, `type-h2` header style.
- Pattern description line: renders the response's `tollReentryDescription` field verbatim (e.g., "exits and re-enters Highway 407") wrapped in a short fixed lead-in ("Uses {highway} — {description}"). If `tollReentryDescription` is absent/empty for some reason, fall back to generic copy: "This route gets on and off a toll highway more than once during the trip."
- **Two toggle buttons per card, not a single checkbox.** Neither is pre-selected — an explicit tap is required on one of the two before that card counts as "answered." (No default/implicit answer — see §5a.4's rationale, matching this spec's existing "never silently assume consent" posture, e.g. §3's password gate, §4.1's validation-before-submit approach.)
  - "Yes, that's fine" — selected state: filled `color-brand-primary` background, `color-on-brand-primary` text/icon (check).
  - "No, don't include it" — selected state: `color-danger-border` outline, `color-danger-text` text/icon (X). Choosing this does not remove the card from this screen (the user should still be able to change their mind before tapping Continue) — exclusion only takes effect once Continue is tapped and the confirm request is sent.
  - Unselected/default state (before either is tapped): both buttons render as neutral outline buttons (`color-border-default`, `color-text-primary`), same visual weight — deliberately not defaulting either option to look "recommended," since this is a genuine yes/no question, not a suggested action.
- Primary CTA "Continue": **disabled until every card on screen has an explicit answer.** This is a deliberate parallel to the Input Screen's "CTA disabled until all fields valid" pattern (§4.3) — same mechanism, same reasoning (force a complete, explicit answer set before proceeding, never submit a partial/assumed one).

### 5a.3 What happens on Continue

Tapping "Continue" sends `POST /api/drop-off-search/confirm-toll-reentry` (`docs/design.md` §5.2) with `originalRequest` (the untouched original search inputs) and `rejectedCandidateLocations` set to exactly the candidates the user marked "No" (an empty array if every card was answered "Yes" — this is a valid, meaningful request, not skipped, since it's still the mechanism that finalizes the ranked/fallback result and picks up the map polyline etc.). The screen transitions to the Loading screen's reused "Updating your results…" variant (§5.1) while this call is in flight.

### 5a.4 Second round — a newly-promoted candidate also needs confirmation

Per `docs/design.md` §4.6 step 4, excluding a candidate can promote a previously-unchecked candidate into the final result set, and that newly-promoted candidate may itself carry `needsTollReentryConfirmation: true` in the confirm endpoint's response. **Decision: show this exact same screen a second time, for only the newly-flagged candidate(s)** — not the ones already answered in round one (their answers stand; do not re-ask). Distinguish it from round one with a small copy change so it doesn't read as a bug/repeat:

```
   One more thing

   Removing your earlier choice(s)
   brought in a replacement option that
   also needs a quick check.
```
(Replaces the round-one explainer paragraph; card/button mechanics are identical to §5a.2.)

Tapping "Continue" here calls `confirm-toll-reentry` again, with `rejectedCandidateLocations` extended to include this round's new "No" answers alongside the first round's (the request always carries the full cumulative rejection set — this endpoint re-derives the whole search deterministically from `originalRequest` each time per `docs/design.md` §5.2, so there is no partial/incremental state to track client-side beyond this one array).

**Hard cap: at most two confirmation rounds (this screen shown at most twice) per search.** This bounds worst-case added latency/friction to two short interstitials, matching tech-lead's own stated intent of a small, bounded number of round-trips rather than an open-ended chain (`docs/design.md` §4.6's closing paragraph). If, in the rare case of several rounds of exclusion/promotion cascading, the *second* confirm call's response still contains a newly-flagged candidate that has never been shown to the user, **do not show a third screen** — see §9 for how this edge case is resolved and why it is flagged for tech-lead/user confirmation rather than settled unilaterally here.

### 5a.5 States

| State | Behavior |
|---|---|
| Card unanswered | Both toggle buttons neutral/outline; Continue disabled if any card is in this state |
| Card answered "Yes" | Button fills `color-brand-primary`; candidate stays in the final result set |
| Card answered "No" | Button outlines `color-danger-border`; candidate is excluded once Continue is submitted |
| User taps "← Edit search" | Returns to Input screen, values preserved (identical to Results screen behavior, §6.3); no confirm request is ever sent |
| Confirm request in flight | Loading screen, "Updating your results…" variant (§5.1) |
| Confirm request fails (network/provider error) | Same System/Network Failure state as §7 ("Something went wrong…"), with "Try again" re-issuing the identical confirm request (same inputs, same answers already given — the user should never have to re-answer the toll questions because of a transient network failure) |

---

## 6. Screen 3 — Results Screen

### 6.1 Layout overview

```
┌───────────────────────────────────┐
│ ⚠ This is an estimated drop-off     │  STICKY disclaimer banner
│ point only. Confirm it's safe and   │  (always visible, FR-014)
│ legal to stop here before you do.   │
├───────────────────────────────────┤
│ ← Edit search                       │  back to Input, values preserved
│                                     │
│ Your trip: 123 Elm St → 456 Bay St  │  trip summary, type-body-small
│ Passenger to: 789 King St            │
│                                     │
│ [ Fallback warning banner — only    │  conditional, FR-011
│   shown if no candidate met the     │
│   detour threshold ]                │
│                                     │
│ [ Excluded-candidate notice — only  │  conditional, FR-019
│   shown after a §5a toll-reentry    │
│   answer removed 1+ candidates ]    │
│                                     │
│ ┌─ #1  BEST OPTION ───────────────┐│
│ │ Oak Ave & Main St                 ││  type-h2
│ │                                    ││
│ │ DRIVER                             ││  type-label
│ │  Drive to drop-off      8 min      ││
│ │  Added detour          +3 min      ││
│ │  Your total trip       27 min      ││
│ │                                    ││
│ │ PASSENGER                          ││
│ │  Walk to stop           4 min      ││
│ │  Wait + transit        22 min      ││
│ │  Total to destination  26 min      ││
│ └────────────────────────────────┘│
│                                     │
│ ┌─ #2 ────────────────────────────┐│
│ │  …same structure…                 ││
│ └────────────────────────────────┘│
│                                     │
│ ┌─ #3 ────────────────────────────┐│
│ │  …same structure…                 ││
│ └────────────────────────────────┘│
└───────────────────────────────────┘
```

### 6.2 Disclaimer banner — FR-014

- Non-dismissible, sticky to the top of the viewport while scrolling through results (`shadow-md` appears once scrolled, per token above).
- Icon: warning triangle. Text: `type-body-strong`, `color-warning-text` on `color-warning-bg`, `color-warning-border` bottom border.
- Exact copy (do not soften or shorten — this reflects an explicit user decision, not a suggestion):
  > "This is an estimated drop-off point only. Before stopping, confirm it's safe and legal to pull over here."
- **Scope, made explicit (closes REV-015):** the disclaimer is present on every results state **that shows at least one suggested drop-off point** — that is, `ranked` (§6.4) and `fallback` (§6.5) — and on those two states it is the one non-negotiable element that must render even if other rendering fails (this is what REV-012's fix guarantees structurally, via a component-tree boundary that survives a crash in the candidate-rendering code). It is deliberately **not** shown on the `no_viable_option` empty state (§6.6), because the disclaimer's purpose is to caution the driver about a *specific suggested point* before using it, and that state has no point on screen to caution about. The same reasoning excludes it from the input-time out-of-radius block (§4.1) and the system/network failure state (§7) — neither of those ever shows a suggested point either, so neither shows the disclaimer. This scope (`candidates.length > 0`) matches design.md §5.2's contract and the shipped INC-7 implementation exactly; no code change follows from this clarification. See §6.6 for the empty-state mockup and the same reasoning restated there.

### 6.3 Trip summary + "Edit search"

- `type-body-small`, `color-text-secondary`. Shows resolved (not raw-typed) addresses for orientation: "Your trip: {start} → {your destination}" / "Passenger to: {passenger destination}".
- "← Edit search" is a text link, `color-brand-primary`, returns to Input screen with all four values preserved from the just-completed search (in-memory only).

### 6.4 Candidate cards — FR-006, FR-010, FR-013

Ordered top to bottom by rank (ascending passenger total time per FR-010). Each card:

- Rank badge: "#1", "#2", "#3" — `type-label` in a `radius-full` pill.
- Card #1 only: additional "BEST OPTION" label next to the rank badge, and `color-bg-surface-raised` background + `color-brand-primary` left border accent, to visually distinguish the top recommendation. (This is a presentation emphasis on already-ranked data — not new logic. Ranking/order itself comes entirely from FR-010; the visual highlight is UX-only.)
- Location header: best available resolved description of the drop-off point (e.g., nearest cross-street or reverse-geocoded address) — `type-h2`. Assumed feasible with Google Maps Platform's reverse geocoding (tech-lead's selected provider); tech-lead to flag if any candidate points can't be labeled this way, in which case this falls back to a distance-along-route phrasing (e.g., "~2.1 km into your route").
- Two labeled sub-sections, "DRIVER" and "PASSENGER" (`type-label`, `color-text-secondary`), each a simple two-column row list (label left, value right, `type-body` for labels / `type-body-strong` for the values):
  - Driver: Drive to drop-off (FR-006a), Added detour (FR-006b, prefixed with "+"), Your total trip (FR-006f).
  - Passenger: Walk to stop (FR-006c), Wait + transit (FR-006d), Total to destination (FR-006e).
- All times rendered as "`N min`" (round to nearest minute; sub-minute precision is not useful to a driver mid-trip). Detour value in the fallback card only (6.5) is additionally colored `color-danger-text` to draw the eye to the number that's over the threshold.

### 6.4a Excluded-candidate notice — FR-019 (2026-07-12 addition)

Per §0 principle 3 ("never fail silently"), a candidate the user excluded via §5a's toll re-entry question must never simply disappear from the result count with no explanation — a driver who mentally registered "there should be 3 options" and now sees fewer needs to know why, otherwise this reads as a bug, not a result of their own answer.

- Shown only when the Results screen is reached via §5a (i.e., the request path included at least one `confirm-toll-reentry` call with a non-empty `rejectedCandidateLocations`). Never shown on a first-pass search that never triggered §5a at all (the common case) — this is not a generic disclaimer, it only applies to this specific path.
- Position: directly below the disclaimer banner/trip summary and above the fallback warning banner if both are present (fallback and toll-exclusion can co-occur, e.g., excluding a candidate could itself be *why* the search ends in a fallback result).
- Style: a plain informational line, not a warning — `type-body-small`, `color-text-secondary`, no icon, no colored background (this is expected, requested behavior resulting directly from the user's own prior answer, not a problem or a degraded state, so it should not visually compete with the fallback/disclaimer banners' warning styling).
- Copy (count-substituted, singular/plural handled):
  > "1 option was hidden because it exits and re-enters a toll highway during the trip, per your answer."
  > "2 options were hidden because they exit and re-enter a toll highway during the trip, per your answer."
- If the exclusion(s) result in **zero** remaining candidates, this notice is superseded by — not shown alongside — the `no_viable_option` empty state (§6.6), whose own copy should read naturally as a consequence of the search generally (the empty state's existing generic copy already covers this; no toll-specific empty-state variant is introduced, since `no_viable_option`'s trigger reason is not otherwise distinguished in this spec, e.g. "no transit reachable" and "every candidate excluded by your answers" already share the same message treatment).

### 6.5 Fallback state ("closest anyway") — FR-011

Triggered when zero candidates meet the user's detour threshold. Differences from the normal 3-card layout:

- Only **one** card is shown (the single closest-by-passenger-time candidate), not three.
- A warning banner appears above the card (below the disclaimer banner and trip summary), `color-warning-bg`/`color-warning-border`/`color-warning-text`, `type-body-strong`:
  > "None of the drop-off points found keep your detour under {threshold} minutes. Here's the option that gets your passenger there fastest anyway — it adds {actual detour} minutes."
  (Values substituted at render time.)
- The card itself has no "BEST OPTION"/rank badge (there was no ranking among qualifying candidates — there were none); instead it's labeled "CLOSEST OPTION" in the same badge position, styled with `color-warning-border` instead of `color-brand-primary` to visually tie it to the warning banner above.
- The "Added detour" row inside the card is rendered in `color-danger-text` to reinforce that this number exceeded what the user asked for.

### 6.6 No viable option at all — FR-012

If the system cannot produce even one candidate (e.g., no transit reachable from anywhere along the route), Results screen renders an empty state instead of any cards:

```
┌───────────────────────────────────┐
│                                     │
│         (map-pin-slash icon)        │
│                                     │
│   No drop-off points found            │  type-h2
│                                     │
│   We couldn't find a route with      │  type-body, color-text-secondary
│   transit access to the passenger's   │
│   destination along this trip. Try    │
│   a different destination, or check   │
│   back later — transit service may     │
│   vary by time of day.                │
│                                     │
│  ┌───────────────────────────────┐ │
│  │        ← Edit search             │ │
│  └───────────────────────────────┘ │
└───────────────────────────────────┘
```

**Disclaimer, decided (closes REV-015): the disclaimer banner does NOT render on this state.** An earlier version of this spec showed the banner here with the annotation "harmless, consistent — no reason to hide it." That annotation is superseded and should be disregarded — it created a real conflict with design.md §5.2's narrower, `candidates.length > 0`-scoped contract (logged as REV-015). Final decision: this state has no suggested drop-off point on screen, and the disclaimer's entire purpose (§6.2, §0 principle 2) is to caution the driver about a specific suggested point before using it — there is nothing here to caution about, so the banner is omitted, not hidden-but-present. This matches design.md §5.2 and the shipped INC-7 implementation (`showDisclaimer` is `false` whenever `candidates.length === 0`) exactly; no code change follows from this clarification. See §6.2 for the full scope statement, which applies identically to `out_of_service_area`/`invalid_input`/`timeout` (§7) — none of these states show the disclaimer, for the same reason.

Note this is distinct from the out-of-radius case (Screen 1, §4.1), which blocks earlier at input time and never reaches computation.

### 6.6a No toll-free route found — FR-018/OQ-9 (2026-07-12 addition)

Shown only when "Avoid tolls" (§4.2a) is checked and the backend determines no reasonably toll-free driving route exists at all between the given start and destination (`status: "no_toll_free_route"`, `docs/design.md` §4.1a) — a message-only/empty-result outcome, deliberately given the same visual treatment as §6.6's "no viable option" state (per FR-018's explicit text: "similar in shape to the existing FR-012 no viable option pattern," not a fallback-with-warning):

```
┌───────────────────────────────────┐
│                                     │
│         (map-pin-slash icon)        │
│                                     │
│   No toll-free route found           │  type-h2
│                                     │
│   We couldn't find a route that      │  type-body, color-text-secondary
│   avoids tolls for this trip.         │
│   Uncheck "Avoid tolls" to see        │
│   toll-inclusive options, or try a     │
│   different start or destination.      │
│                                     │
│  ┌───────────────────────────────┐ │
│  │        ← Edit search             │ │
│  └───────────────────────────────┘ │
└───────────────────────────────────┘
```

- No disclaimer banner (§6.2's scope — no candidate is on screen to caution about), no map panel (§6.7), no "Try again" CTA (unlike §7's system-failure state, this is a deterministic outcome of the same inputs, not a transient failure — retrying without changing anything would produce the same result, so only "← Edit search" is offered, exactly matching §6.6's precedent).
- This state never reaches §5a — the toll re-entry question (FR-019) explicitly only applies when tolls are allowed (`avoidTolls === false`); when tolls are being avoided entirely, there is no toll segment to exit/re-enter, so this path and §5a's path are mutually exclusive by construction.

### 6.7 Optional enhancement — Map view (pending cost confirmation)

**Status:** approved by the user as an enhancement *conditional on* it not increasing provider API cost (map tile/display billing is typically separate from the Directions/Distance Matrix/Transit calls already in scope for computing results). Tech-lead is confirming this with the chosen provider (Google Maps Platform). This is **not required for MVP core flow** — the card-based layout in §6.1–§6.6 is fully self-sufficient without a map and should be built first regardless of the outcome of that cost check.

**If included, how it fits into the Results screen:**

- A single map panel sits between the trip summary (§6.3) and the candidate cards (§6.4), full-width, roughly 200-240px tall on mobile (`space-lg` margin above/below).
- Content: the driver's route (start → driver's destination) as a line, plus one pin per candidate, labeled with its rank badge ("#1", "#2", "#3") so the map and the cards below use the same visual vocabulary. The rank-1 pin uses `color-brand-primary`; ranks 2-3 use a neutral marker color (`color-text-secondary` equivalent for map markers) so the top pick still reads as the emphasized one, consistent with the card highlight in §6.4.
- Tapping a pin scrolls/highlights the corresponding card below (brief `color-bg-surface-raised`-style flash on the card); tapping a card does not need to re-center the map (keeps interaction one-directional and simple).
- In the fallback state (§6.5, single card), the map shows only that one pin, using the same warning-colored marker (`color-warning-border` equivalent) as the card's "CLOSEST OPTION" badge.
- In the no-viable-option state (§6.6) and any error state (§7), the map panel is omitted entirely rather than shown empty — there's nothing meaningful to plot.
- The map is display-only for v1 (no pan/zoom-driven re-querying, no draggable pins, no "recenter" controls beyond whatever the map SDK provides by default) — keeps it a presentation layer over already-computed results, not a new input surface.
- Loading state (§5) is unaffected — the map only ever appears on the Results screen once candidates exist.
- Accessibility: the map is supplementary to the text-based cards, not a replacement — a screen-reader user or a user on a slow connection where the map fails to load must still get the complete, correct picture from the cards alone. If the map tile/script fails to load, fail silently and simply omit the panel (do not show a broken-map placeholder or block the cards from rendering).

**If tech-lead determines this does increase cost** materially, this section is deferred/dropped with no impact on any other part of this spec — no other screen or flow depends on the map being present.

---

## 7. System/Network Failure State (not tied to a single screen)

Applies whenever the backend request itself fails (timeout, provider outage, unexpected server error) rather than returning a valid "no candidates" result. Replaces the Loading screen with:

```
┌───────────────────────────────────┐
│                                     │
│           (error icon)              │
│                                     │
│   Something went wrong               │  type-h2
│                                     │
│   We ran into a problem finding      │  type-body, color-text-secondary
│   drop-off points. This is usually    │
│   temporary.                          │
│                                     │
│  ┌───────────────────────────────┐ │
│  │            Try again             │ │  primary CTA — re-submits same inputs
│  └───────────────────────────────┘ │
│  ┌───────────────────────────────┐ │
│  │        ← Edit search             │ │  secondary — returns to Input
│  └───────────────────────────────┘ │
└───────────────────────────────────┘
```

- "Try again" re-issues the identical request with the same inputs (no need to re-type anything) — goes back through the Loading state.
- If the browser reports the device is offline (`navigator.onLine === false` or equivalent), swap the body copy to: "You appear to be offline. Check your connection and try again." This is a presentation-only branch of the same screen, not a new one.
- No specific retry-count limit or backoff is specified here; that's a dev/tech-lead concern if it becomes necessary.

---

## 8. Accessibility notes (brief, applies across all screens)

- All interactive elements reachable and operable by keyboard; focus visible via `color-focus-ring`.
- Color is never the only signal: every warning/error/danger state pairs a color with an icon and/or text, never color alone (relevant for the disclaimer banner, fallback warning, and field errors above).
- Minimum body text size 16px; form inputs never smaller than 16px (prevents mobile browser auto-zoom).
- Autocomplete suggestion lists follow ARIA combobox pattern (announced to screen readers, arrow-key navigable).

---

## 9. Open UX Questions

All prior open questions have been resolved by the user (see below). Several items remain open; none blocks Gate 3 sign-off on the rest of this spec, but two (items 2 and 3 below) are new as of the 2026-07-12 FR-018/FR-019 addendum and should be routed to tech-lead/pm before INC-14 build starts, not treated as silently settled by this spec alone.

**Remaining:**

1. **"Taking longer than expected" threshold (§5):** the exact wait time before the loading screen's copy changes, and the point at which a slow request is treated as a hard failure (§7), should match whatever request timeout tech-lead configures server-side. Needs a config value name/handoff from `docs/design.md`. This is an implementation-detail coordination item, not a UX decision, and does not block Gate 3.

2. **(New, 2026-07-12) Round-cap edge-case behavior for §5a's toll re-entry confirmation — flagged for tech-lead/user, not decided unilaterally here.** §5a.4 hard-caps the toll re-entry confirmation to at most two rounds (two screen showings) per search, to bound worst-case latency/friction, per tech-lead's own stated intent of a small bounded number of round-trips rather than an open-ended chain. This spec has **not** decided what happens in the rare residual case where, after the second (capped) confirm call, the response still contains a newly-promoted candidate that has never been shown to the user for confirmation. Two candidate resolutions, with genuinely different product consequences:
   - **(a) Auto-exclude at the cap** (drop the unconfirmed candidate the same way an explicit "No" would, and fold it into §6.4a's excluded-candidate count/copy) — conservative, never shows the user something not affirmatively approved, consistent with this spec's "never assume consent" posture (§5a.2's no-default-answer design), but technically shows the user *fewer* candidates than the underlying search actually found, without ever having asked about the specific one being dropped.
   - **(b) Auto-include at the cap, with a passive disclosure** (show the candidate in final Results, with a small note on its card acknowledging the pattern exists but wasn't re-confirmed) — surfaces more genuine options to the user, but risks reading as inconsistent ("why did you ask me about the first two toll patterns but not this one") and is arguably a closer literal reading of FR-019's "the system shall present the user with a question" (unqualified by round count) — an outcome dev/QA/reviewer could later flag as a gap against FR-019's letter if (a) is chosen instead.
   Designer's recommendation, if forced to pick one today without further input, leans **(a)** (safer, more consistent with this spec's existing conservative defaults elsewhere), but this is exactly the kind of requirements-interpretation trade-off (how literally must FR-019's "shall present... a question" be honored against a designed round cap) that this project's no-inference rule says should go to the user via pm, not be resolved silently by designer alone — flagging it here rather than picking (a) and moving on. This is expected to be a genuinely rare case in practice (requires at least two rounds of exclusion-then-promotion, each producing a further re-entry-flagged candidate).

3. **(New, 2026-07-12) FR-020, FR-021, FR-022 UI treatment not yet in this spec.** This addendum's scope was FR-018 (avoid-tolls checkbox, §4.2a) and FR-019 (toll re-entry confirmation flow, §5a/§6.4a/§6.6a) only, per the task that produced it. FR-020 (highway exclusion) needs no UI — it is a silent, always-on server-side candidate filter with no user-visible state. FR-021 (transit stop/line/direction detail on every candidate card) and FR-022 (replacing §6.7's Leaflet map mockup with Google Maps JavaScript API rendering) still need a designer pass — tracked here so this is a known, explicit gap rather than an accidental omission, not something requiring user input to resolve (it's simply not-yet-done work).

**Resolved (for record):**

1. ~~Candidate location label feasibility~~ — assumed to work via Google Maps Platform reverse geocoding per tech-lead; fallback phrasing specified in §6.4 if tech-lead flags otherwise.
2. ~~Map/visual route view~~ — approved as a conditional enhancement (pending no added provider cost); full spec in §6.7.
3. ~~Detour-input sanity ceiling~~ — resolved: no upper bound, plain numeric input (§4.2).
4. ~~Password gate throttling~~ — resolved: no lockout/rate-limiting, simple inline error only (§3).
5. ~~Product naming/branding~~ — resolved: "DropSpot" selected and applied throughout this spec (§0.0).
6. ~~Undocumented `provider_error` field state (REV-008)~~ — resolved: formally added to §4.1's field-states table as "Lookup failed (provider/network error)"; see Changelog below.

---

## 10. Changelog

| Date | Change |
|---|---|
| 2026-07-11 | Added "Lookup failed (provider/network error)" to §4.1's field-states table, closing the traceability gap flagged in review-log.md REV-008. This documents the state dev added during INC-2 for when a geocoding lookup itself fails to complete (network/provider error), distinct from "Unresolvable address" (lookup completed, no match found). Copy: "We couldn't check that address right now. Please try again." Applies to all three location fields (lookup-mechanism failure, not field-specific business logic). User confirmed keeping this addition. |
| 2026-07-12 | **FR-018/FR-019 addendum (toll avoidance checkbox and toll re-entry confirmation flow), status DRAFT pending Gate 3.** Added: §4.2a "Avoid tolls" checkbox on the Input Screen (FR-018), plus its new empty-result outcome, "No toll-free route found" (§6.6a, FR-018/OQ-9). Added new conditional Screen 2a, "Toll Road Check" (§5a, FR-019) — a batched, per-candidate confirmation interstitial shown between Loading and Results only when the search response flags one or more final candidates with a toll-road exit/re-entry pattern; resolves tech-lead's explicitly-flagged open interaction-model question (`docs/design.md` §1.4/§4.6) in favor of a conditional interstitial (not an upfront Input-Screen question, not an inline Results-screen prompt), batched presentation with per-candidate (not whole-trip) answers, and a hard two-round cap matching tech-lead's stateless/bounded-round-trip design intent. Added §6.4a, the excluded-candidate notice on Results, so a candidate the user rejected via §5a never simply vanishes without explanation (§0 principle 3). Updated §1's screen inventory table and flow line, and §5's Loading screen (§5.1) to note its reuse (with swapped copy) during toll re-entry re-computation. Flagged one genuine open question in §9 (round-cap residual edge case — auto-exclude vs. auto-include-with-disclosure) for tech-lead/user rather than resolved unilaterally, and explicitly noted FR-020/FR-021/FR-022 UI treatment remains outside this addendum's scope, tracked as a known gap. | Designer task, part of the FR-018–FR-022 change request (`docs/requirements.md` FR-018/FR-019, approved 2026-07-12; `docs/design.md` §1.4/§4.6, DRAFT pending user approval). Tech-lead deliberately left the FR-019 interaction model as a genuine UX decision rather than presenting a finalized contract, recommending only the underlying stateless two-endpoint mechanism (batch-ask-once, one bounded confirm round-trip) for cost/latency reasons — this entry is designer's resolution of that flagged decision. |
| 2026-07-11 | **Closes REV-015.** Resolved the §6.2/§6.6 disclaimer-scope ambiguity the reviewer flagged: §6.6's `no_viable_option` mockup previously showed the disclaimer banner present with an annotation ("harmless, consistent — no reason to hide it") that conflicted with design.md §5.2's narrower `candidates.length > 0` contract and the shipped INC-7 code. **Decision: the disclaimer is scoped to `ranked`/`fallback` only** (states that show a suggested drop-off point) and is explicitly **not** shown on `no_viable_option`, `out_of_service_area`, `invalid_input`, or `timeout`/system-failure states. Rationale: the disclaimer's purpose is to caution the driver about a *specific suggested point* before using it (§0 principle 2); a state with no point on screen has nothing to caution about. This choice matches the already-implemented behavior — no code change required. §6.2 now states this scope explicitly; §6.6's mockup no longer shows the banner and its annotation is superseded. Designer judgment call, not escalated to the user (reviewer confirmed no candidate is ever shown without the disclaimer under either reading, so no safety exposure was at stake either way). |
