# UX Spec: DropSpot

Status: FINAL — ready for Gate 3 review alongside `docs/design.md`. **Addendum 2026-07-12 (toll flow)**: §4.2a, §5a, §6.6a, and the excluded-candidate notice in §6.4 add the FR-018 ("avoid tolls" checkbox) and FR-019 (toll re-entry confirmation) flow, per the 2026-07-12 change request. §5a.4's round-cap edge case (formerly an open question) is now resolved — see §5a.4 and §9. **Addendum 2026-07-12 (UI modernization pass)**: this spec has been revised throughout — visual system (§2), every screen spec, and the candidate card in particular (§6.4) — per change-request item 5 ("modern, easy to use, think Google Maps/Waze/Apple Maps") and to fold in the UI design for FR-021 (transit stop/line/direction detail on every candidate card, both boarding and arrival stops — see §6.4/§6.4b) and FR-022 (Google Maps JavaScript API rendering, replacing the Leaflet mockup — see §6.7, now approved and no longer cost-conditional). FR-020 (highway exclusion) remains confirmed silent/no-UI — see §6.4c for the explicit reasoning, not just an assertion. This is now the current, ready-to-build version of this spec; no open designer gap remains from the 2026-07-12 change request.
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
5. **Plain language over jargon, always (2026-07-12).** Every label a driver reads mid-trip must be understandable at a glance, without decoding internal terminology or shorthand. If a label needs a mental "translation step" (e.g., a compressed phrase like "Wait + transit" that reads like an internal formula rather than a sentence), it fails this principle and must be rewritten — not explained with a tooltip. This principle directly drove the candidate-card relabeling in §6.4.
6. **Confident visual hierarchy, one clear "best" answer (2026-07-12).** Modern map/navigation apps (Google Maps, Waze, Apple Maps) use color, elevation, and size decisively to show the user the one option that matters most, then let everything else recede. This spec follows that convention: the top-ranked candidate is visually unmistakable (elevation, accent color, default-expanded detail), and secondary candidates are deliberately quieter (flatter, collapsed by default) rather than competing for equal attention. This is a presentation-only emphasis on already-ranked data (FR-010) — it never changes what data is shown, only how much visual weight it carries by default.

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

**2026-07-12 revision note:** this section has been revised as part of the full UI modernization pass (change-request item 5 — "modern, easy to use... think Google Maps/Waze/Apple Maps"). Additions/changes are marked **(new)**/**(revised)** below; unmarked tokens are unchanged from the original system. The intent of the revision is a more confident, "elevated card over a map" visual language (larger corner radii, softer/deeper shadows on the elements that should read as foreground, a secondary accent color for transit-specific content so brand blue isn't overloaded onto everything) rather than a wholesale palette change — this app's existing color identity is kept, not replaced.

### 2.1 Color tokens

| Token | Purpose | Example value |
|---|---|---|
| `color-bg-page` | App background | `#F7F8FA` |
| `color-bg-surface` | Card / input background | `#FFFFFF` |
| `color-bg-surface-raised` | Rank-1 ("top pick") card background | `#F0F7FF` |
| `color-bg-surface-sunken` **(new)** | Resting background for collapsed/secondary content (e.g., a collapsed candidate card's summary strip) — a touch darker than `color-bg-surface` so expanded/primary content reads as "lifted" above it | `#FAFBFC` |
| `color-border-default` | Default input/card border | `#D8DCE1` |
| `color-border-focus` | Focused input border | `color-brand-primary` |
| `color-text-primary` | Main text | `#1A1D21` |
| `color-text-secondary` | Helper/meta text | `#5B6470` |
| `color-text-disabled` | Disabled text | `#A2A9B3` |
| `color-brand-primary` | CTA buttons, links, active/rank-1 accents | `#1E6FD9` |
| `color-brand-primary-hover` | Hover/pressed state of primary | `#175BB0` |
| `color-on-brand-primary` | Text/icons on primary-colored surfaces | `#FFFFFF` |
| `color-accent-transit` **(new)** | Transit-specific icons, mode badges, and the line/direction pill on candidate cards (§6.4) — deliberately distinct from `color-brand-primary` so brand blue stays reserved for CTAs, links, and "this is the top pick" signaling, and doesn't get diluted by appearing on every transit icon on every card | `#00897B` |
| `color-on-accent-transit` **(new)** | Text/icons on `color-accent-transit`-colored surfaces (e.g., inside a filled line-name pill) | `#FFFFFF` |
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
| `type-metric` **(new)** | 28/32 | 700 | Headline numeral on a candidate card (e.g., the passenger total-time figure) — a large, confident number in the style of Google Maps/Waze's route-summary screens, not just bolded body text |
| `type-h1` | 22/28 | 700 | App title |
| `type-h2` | 18/24 | 600 | Section headers, candidate address per card |
| `type-h3` **(new)** | 16/22 | 600 | Card subsection titles ("For the driver," "For your passenger") — sentence case, icon-led (§2.6), replacing the all-caps `type-label` treatment those subsections previously used, which read as dated/corporate rather than conversational |
| `type-body` | 16/24 | 400 | Default copy, input text |
| `type-body-strong` | 16/24 | 600 | Disclaimer text, key numbers (totals) |
| `type-body-small` | 14/20 | 400 | Helper text, secondary breakdown rows |
| `type-label` | 12/16, uppercase, +0.04em tracking | 600 | Field labels (Input Screen only, §4), rank badges. **(Revised scope)** No longer used for candidate-card subsection headers (see `type-h3` above) — reserved for form field labels and small pill/badge text, where all-caps reads as a label/tag rather than a sentence a user has to parse as prose. |
| `type-caption` | 12/16 | 400 | Least-emphasis meta text only (never used for the disclaimer) |

### 2.4 Shape & elevation

| Token | Value | Usage |
|---|---|---|
| `radius-sm` | 4px | Inputs, field-error boxes |
| `radius-md` **(revised: 8px → 12px)** | 12px | Cards, secondary buttons. Increased from 8px for a softer, more current look consistent with the Google Maps/Waze/Apple Maps reference points, which all favor generously rounded surfaces over sharp-cornered ones. |
| `radius-lg` **(new)** | 20px | The expanded/top-pick candidate card (§6.4), and the map panel (§6.7) — reserved for the "primary, elevated" surfaces on a screen, so the size of the radius itself communicates emphasis, not just decoration |
| `radius-full` | 999px | Rank/mode badges, pills, **and — revised — all primary CTA buttons app-wide** (previously `radius-md`). Fully-rounded primary buttons are a consistent visual signature across Google Maps, Waze, and Apple Maps and read as more current than a slightly-rounded rectangle; secondary/text buttons keep `radius-md`. |
| `shadow-sm` | `0 1px 2px rgba(0,0,0,0.08)` | Resting cards (collapsed candidate cards, default input state) |
| `shadow-md` | `0 2px 8px rgba(0,0,0,0.12)` | Sticky banner once page has scrolled; resting state of a normal (non-top-pick) card |
| `shadow-lg` **(new)** | `0 8px 24px rgba(0,0,0,0.16)` | The expanded/top-pick candidate card and the map panel — a visibly deeper "floating over the map" elevation, reserved for the one or two elements per screen that should read as unambiguously foreground |

### 2.5 Layout

- Mobile default: single column, full-bleed sections, `space-md` side padding.
- `>= 600px` viewport: content centers in a `container-max-width: 480px` column (this stays a single linear flow — no multi-column grid is introduced at wider viewports).
- Minimum tap target: 44x44px for all buttons/icons (geolocation buttons, badges are not tappable so exempt).

### 2.6 Iconography (new, 2026-07-12)

Modern map apps lean on a small, consistent icon vocabulary to let users scan a screen instead of reading every word — this app currently has almost none (a search glyph and a pin, both text-adjacent decoration rather than meaningful signal). This pass introduces a minimal, purposeful icon set used consistently across the Input and Results screens:

| Icon | Meaning | Used in |
|---|---|---|
| Walking figure | A walking leg of a journey | Candidate card passenger itinerary (§6.4), location field prefix |
| Bus / train glyph (mode-specific if the transit provider's mode is known — bus vs. subway/rail vs. tram — otherwise a generic transit glyph) | A transit leg of a journey | Candidate card passenger itinerary (§6.4) |
| Car | The driver's leg | Candidate card driver section (§6.4) |
| Pin (filled, colored per rank — see §6.7) | A candidate drop-off point | Map view (§6.7), card header |
| Flag / checkered-flag-style glyph | Final arrival at the passenger's destination | End of the passenger itinerary strip (§6.4) |
| Check / X (already specified) | Toll re-entry confirm/reject (§5a) | Toll Road Check screen |
| Warning triangle (already specified) | Disclaimer, fallback, error states | §6.2, §6.5, §7 |

Rules:
- **Icons never appear without an accompanying text label** in this app (icons alone are ambiguous for a safety-adjacent, one-shot tool with no onboarding) — this is a strengthening of, not a change to, the existing accessibility rule that color is never the only signal (§8).
- Icon sizes use `icon-size-sm` (16px, inline with `type-body-small`), `icon-size-md` (20px, inline with `type-body`/card row icons), `icon-size-lg` (24px, section/journey-strip icons).
- Icon color follows context: neutral (`color-text-secondary`) for structural/informational icons (walking figure, car), `color-accent-transit` for transit-mode icons and the line/direction badge, `color-brand-primary` only for the top-pick card's rank badge and CTAs, matching §0 principle 6's "don't overload one accent color" intent.

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
- **(Revised, 2026-07-12)** Lock glyph sits inside a filled `color-bg-surface-raised` circle (roughly 56px) rather than floating bare — a small, standard "friendly app icon badge" treatment that reads as considered rather than a placeholder emoji.
- Password `<input type="password">`, `radius-md` (12px, §2.4), with a "Show"/"Hide" toggle (accessibility + reduces mistyping on mobile). 16px min font size.
- Primary button "Continue" — full width, `radius-full` (§2.4), `color-brand-primary` background, disabled (visually `color-text-disabled` state) while the field is empty.
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

**(Revised, 2026-07-12 — modernization pass.)** The three location fields are now visually connected by a vertical timeline (a thin `color-border-default` line with a small dot/pin marker at each field), the same "stops on a route" visual pattern used by Google Maps, Waze, and most trip-planning apps to make it immediately legible that these three fields are stages of one route, not three unrelated form fields. This replaces the previous plain-stacked-fields layout; no new fields, no change to validation behavior (§4.1) — presentation only.

```
┌───────────────────────────────────┐
│  DropSpot                          │  type-h1
│  Find the best spot along your      │  type-body-small, color-text-secondary
│  route to drop someone off for      │
│  transit.                           │
├───────────────────────────────────┤
│  ● YOUR START POINT                 │  type-label; ● = filled dot, top of timeline
│  │┌───────────────────────────────┐│
│  ││ 🔍 Enter an address…            ││  text input w/ autocomplete, radius-md
│  │└───────────────────────────────┘│
│  │  📍 Use my current location       │  pill-shaped secondary button, radius-full
│  │                                  │
│  ● YOUR DESTINATION                 │  timeline continues
│  │┌───────────────────────────────┐│
│  ││ 🔍 Enter an address…            ││
│  │└───────────────────────────────┘│
│  │  📍 Use my current location       │
│  │                                  │
│  ▼ PASSENGER'S DESTINATION           │  ▼ = final marker, timeline ends
│   ┌───────────────────────────────┐ │
│   │ 🔍 Enter an address…            │ │
│   └───────────────────────────────┘ │
│   📍 Use my current location          │
│                                     │
│  MAX ACCEPTABLE DETOUR (MINUTES)     │  type-label, outside the timeline
│  ┌───────────────────────────────┐ │  (this and "avoid tolls" are trip
│  │ e.g. 10                         │ │  preferences, not route points, so
│  └───────────────────────────────┘ │  they deliberately sit outside the
│                                     │  visual "stops" metaphor)
│  ☐ Avoid tolls                      │  checkbox, unchecked by default
│                                     │
│  ┌───────────────────────────────┐ │
│  │      Find drop-off points        │ │  primary CTA, radius-full, disabled
│  └───────────────────────────────┘ │  until valid
└───────────────────────────────────┘
```

Timeline detail: each of the three markers is a small filled circle (8px) in `color-text-secondary` while its field is unresolved, and switches to `color-brand-primary` once that field resolves to a valid address (§4.1's "Resolved/valid" state) — giving the user a quick, at-a-glance read of trip-setup progress without adding any new copy or a progress bar. The passenger's destination marker uses a distinct shape (a small flag/pin instead of a dot, per §2.6's iconography) since it's conceptually the "final stop" of the whole trip, not a midpoint like the driver's own destination.

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
│   ✓ Checking your route              │  stepped status list, see below
│   ⋯ Checking live traffic             │
│     Checking transit options          │
│                                     │
│              Cancel                  │  text link, returns to Input
│                                     │
└───────────────────────────────────┘
```

- Spinner/progress indicator: indeterminate (no percentage — the system cannot know provider latency in advance).
- Primary line: `type-h2`. Secondary line: `type-body-small`, `color-text-secondary`.
- **(Revised, 2026-07-12 — modernization pass.)** Replaces the previous single static "Checking live traffic and transit data" line with a short **stepped status list** (3 short stages: "Checking your route" → "Checking live traffic" → "Checking transit options"), each shown with a checkmark once its stage is presumed complete and a subtle pulsing indicator on the current stage. This is a cosmetic pacing device, not a real progress bar tied to actual backend milestones (the backend does not stream stage-by-stage completion events, and this spec does not require dev to add that) — timings for when each step advances to "done" are a fixed, approximate client-side cadence (exact ms values are a dev implementation detail, not specified here, same as the existing debounce precedent in §4.1). The purpose is purely to make the wait feel active and specific rather than a generic spinner with no sense of what's happening, consistent with §0 principle 4 and the "Google Maps calculating your route" reference point — it must never claim a stage is done if the request has already failed (an error transitions straight to §7, it does not first "complete" a fake stage).
- "Cancel" text link: `type-body`, `color-brand-primary`. Returns the user to the Input screen with their previously entered values still populated (in-memory only; not persisted).
- If the wait extends meaningfully beyond the target in NFR-004 (exact threshold to coordinate with tech-lead's chosen timeout/config — not specified in requirements, flagged in Open Questions), swap the secondary line to:
  > "Still working — this is taking a little longer than usual."
  Do not show an error until the request actually fails or times out server-side; a slow-but-succeeding request should never show a false error. The stepped status list is unaffected — it simply stays on its last stage.

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

**Hard cap: at most two confirmation rounds (this screen shown at most twice) per search.** This bounds worst-case added latency/friction to two short interstitials, matching tech-lead's own stated intent of a small, bounded number of round-trips rather than an open-ended chain (`docs/design.md` §4.6's closing paragraph). If, in the rare case of several rounds of exclusion/promotion cascading, the *second* confirm call's response still contains a newly-flagged candidate that has never been shown to the user, **do not show a third screen.**

**Resolved (2026-07-12, closes the former §9 open question): this residual candidate is auto-included in the final Results, with a visible per-card disclosure — not auto-excluded.** The user decided this directly: showing fewer options than the search actually found, without ever asking about the specific one being dropped, is a worse and less honest outcome than showing the option with an explicit, honest note that its toll behavior wasn't confirmed. Concretely:
- The candidate is included in the ranked/fallback result set exactly as if it had been answered "Yes" for ranking/inclusion purposes (it is not silently treated as either answered "Yes" or answered "No" — see the disclosure copy below, which is careful not to imply either).
- Its card (§6.4) carries a small, non-dismissible inline disclosure directly under the candidate's location header, styled as neutral informational text (not a warning — `type-body-small`, `color-text-secondary`, no icon, no colored background; this is a known-limitation disclosure, not a danger/warning state), reading:
  > "This option uses a toll highway that exits and re-enters during the trip. We weren't able to ask you about it — your answer for the other option(s) doesn't apply here."
  This copy is deliberately honest in both directions: it does not say the pattern was accepted, and it does not say it was rejected — it states plainly that this specific candidate's toll re-entry status is unconfirmed, and explains why (the round cap), without exposing internal terms like "round cap" or "confirmation round" to the user.
- This disclosure is **per-candidate**, not a screen-level banner — if two rounds of exclusion/promotion somehow left more than one such candidate unconfirmed (round cap is on rounds, not on candidate count within a round), each carries its own copy of this same note independently; it is not batched into one summary line the way §6.4a's excluded-candidate notice is (that notice describes candidates no longer present; this describes a candidate that *is* present, so it belongs on that specific card, not in a screen-level aside).
- If this candidate is later excluded anyway (e.g., it doesn't survive ranking/detour filtering for unrelated reasons), no disclosure is shown for it, consistent with the disclosure only ever applying to a candidate the user can actually see and might act on.

This resolves the open UX question previously logged in §9 — see §9's "Resolved" list below and the Changelog (§10) for the full record of the decision.

### 5a.5 States

| State | Behavior |
|---|---|
| Card unanswered | Both toggle buttons neutral/outline; Continue disabled if any card is in this state |
| Card answered "Yes" | Button fills `color-brand-primary`; candidate stays in the final result set |
| Card answered "No" | Button outlines `color-danger-border`; candidate is excluded once Continue is submitted |
| User taps "← Edit search" | Returns to Input screen, values preserved (identical to Results screen behavior, §6.3); no confirm request is ever sent |
| Confirm request in flight | Loading screen, "Updating your results…" variant (§5.1) |
| Confirm request fails (network/provider error) | Same System/Network Failure state as §7 ("Something went wrong…"), with "Try again" re-issuing the identical confirm request (same inputs, same answers already given — the user should never have to re-answer the toll questions because of a transient network failure) |
| Round cap reached with a still-unconfirmed candidate (2026-07-12) | No third screen shown. That candidate proceeds straight to Results, included in the candidate set, carrying its own per-card disclosure (§5a.4, §6.4) |

---

## 6. Screen 3 — Results Screen

### 6.1 Layout overview

**(Revised, 2026-07-12 — modernization pass + FR-021.)** The candidate card is substantially redesigned in §6.4 to (a) fix the jargon-y "Walk to stop"/"Wait + transit" labeling flagged directly by the user, and (b) accommodate FR-021's new required detail (boarding/arrival stop name, line, direction on every card) without the card becoming a wall of small text rows. The layout overview below reflects the new card shape; full rationale and the complete card spec are in §6.4.

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
│ [ Map panel — §6.7, if enabled ]     │
│                                     │
│ ┌── #1  TOP PICK ─────────────────┐│  radius-lg, shadow-lg, expanded
│ │ Oak Ave & Main St                 ││  by default (§6.4)
│ │                                    ││
│ │        26 min                     ││  type-metric — passenger total
│ │        total for your passenger   ││
│ │                                    ││
│ │ 🚶 4 min  🚌 22 min  🏁            ││  journey strip (icons, §2.6)
│ │  Walk    506 → Downtown Loop      ││
│ │                                    ││
│ │ For the driver                     ││  type-h3, icon-led
│ │  Drive time            8 min       ││
│ │  Added detour          +3 min      ││
│ │  Driver's total trip   27 min       ││
│ │                                    ││
│ │ For your passenger                  ││  type-h3, icon-led
│ │  Walk to Oak Ave & Main             ││
│ │   stop                  4 min       ││
│ │  Board 506 → Downtown Loop           ││  transit pill, color-accent-transit
│ │   wait & ride           22 min       ││
│ │  Arrive at Bay St Station             ││
│ │  Total to destination   26 min       ││
│ └────────────────────────────────┘│
│                                     │
│ ┌─ #2 ─────────  22 min total ────┐│  radius-md, shadow-sm, collapsed
│ │ Elm St & 5th Ave     🚶 🚌 🏁      ││  by default — tap to expand
│ └────────────────────────────────┘│
│                                     │
│ ┌─ #3 ─────────  29 min total ────┐│  collapsed
│ │ King St & River Rd   🚶 🚌 🏁      ││
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

### 6.4 Candidate cards — FR-006, FR-010, FR-013, FR-021 (redesigned 2026-07-12)

**Why this card is redesigned, not just relabeled.** Two things converge on this one component: (1) the user directly flagged the existing row labels — "Walk to stop," "Wait + transit" — as confusing/jargon-y, and asked for the whole app to feel modern; (2) FR-021 requires substantially more information per card (boarding stop name/line/direction *and* arrival stop name/line/direction, on **every** candidate, not just the top pick). Bolting FR-021's new fields onto the old flat label/value row list would have made the confusion worse, not better (more rows of compressed labels). So this section is a full redesign of the card's content hierarchy, not an incremental patch.

**Design approach:** treat the passenger's journey as a short, visual itinerary (walk → transit → arrival), the way Google Maps/Transit-app results screens do, rather than a flat table of "label: value" rows. This does three things at once: it gives FR-021's line/direction data a natural home (labeled directly on the transit step, where it's self-explanatory in context, rather than as a standalone unexplained row), it removes the confusing compressed labels entirely (there is no longer a row that has to be named "Wait + transit" — see the relabeling table below), and it gives the card a clear visual hierarchy (one headline number, then a scannable strip, then full detail) instead of nine same-weight text rows.

**Labeling fix — old vs. new, and why:**

| Old label (confusing) | New treatment | Why |
|---|---|---|
| "Walk to stop" | "Walk to **{boardingStop.name}**" | Naming the actual stop (already available once FR-021 ships) is more concrete and useful than the generic word "stop," and matches how Google Maps/Waze phrase walking directions ("Walk to Main St & 5th Ave"), not an internal label. |
| "Wait + transit" | "Board **{lineName} → {headsign}**" (a colored pill, `color-accent-transit`) as the step's identity, with "wait & ride" as small `type-caption` under it and the time value alongside | The old label tried to name a *duration* ("wait + transit") without naming *what it's for* — a driver/passenger reading it has to infer there's a bus/train involved. The new version leads with the concrete, useful fact (which line, which direction) — the same information FR-021 requires anyway — so the duration reads in context ("22 min" next to "506 → Downtown Loop") instead of as a bare compound label. |
| "Total to destination" | "Total to destination" (kept, unchanged) | Already plain language — not part of the reported confusion, no reason to change it. |
| "Drive to drop-off" | "Drive time" | Minor tightening for consistency of voice with the new passenger-side labels; not itself flagged as confusing, low-risk simplification. |
| "Your total trip" | "Driver's total trip" | Clarifies whose total this is now that the card also prominently shows the passenger's total (see headline number below) — avoids "total trip" reading ambiguously once two totals appear on the same card. |

**Card anatomy (top to bottom):**
1. **Header row:** rank badge ("#1", "#2", "#3" — `type-label` in a `radius-full` pill) + location name (`type-h2`, best available resolved description per the existing reverse-geocoding approach, unchanged from the prior spec — falls back to distance-along-route phrasing if a point can't be labeled).
2. **Card #1 only — "TOP PICK" pill** (replacing "BEST OPTION" — shorter, less shouty, same meaning) next to the rank badge. Card #1 uses `color-bg-surface-raised` background, `color-brand-primary` left border accent, `radius-lg` + `shadow-lg` (§2.4) instead of the standard `radius-md`/`shadow-sm`, so the top pick reads as physically "lifted" above the others, not just differently colored. (Presentation emphasis only on already-ranked data — FR-010 owns the ranking itself.)
3. **Headline metric** (`type-metric`, `color-text-primary`, `color-brand-primary` on card #1 only): the passenger's total time, large and unmissable, with a small caption underneath ("total for your passenger") — this is the number the ranking (FR-010) is actually based on, so it's the number that should dominate the card, ahead of any individual leg's time.
4. **Journey strip:** a single horizontal row of icons + short durations summarizing the passenger's path — walking figure + minutes, transit-mode glyph + minutes, arrival flag (§2.6) — giving a glanceable shape of the trip before any detailed reading. For a walking-only candidate (DEC-3), the strip shows only the walking figure + total minutes + arrival flag, no transit glyph.
5. **"For the driver" section** (`type-h3`, car icon, §2.6 — replacing the old all-caps "DRIVER" label): Drive time (FR-006a), Added detour (FR-006b, "+" prefix), Driver's total trip (FR-006f). Simple two-column rows, `type-body` label / `type-body-strong` value, unchanged mechanically from the prior spec.
6. **"For your passenger" section** (`type-h3`, walking-figure icon, §2.6 — replacing "PASSENGER"): the full itinerary, one row per leg:
   - "Walk to {boardingStop.name}" — {walkMinutes} min (FR-006c; FR-021a for the stop name)
   - "Board {lineName} → {headsign}" pill (`color-accent-transit` background, `color-on-accent-transit` text — FR-021b/c) with "wait & ride" caption — {waitPlusTransitMinutes} min (FR-006d; this is the same combined wait+ride duration the old "Wait + transit" row showed — the underlying value is unchanged, only its label/presentation is)
   - "Arrive at {arrivalStop.name}" (FR-021a for the arrival stop) — no separate duration on this row; it's a waypoint label, not a timed leg
   - "Total to destination" — {totalMinutes} min (FR-006e), `type-body-strong`, visually the closing/summary row of this section
   - **Walking-only candidate (DEC-3):** rows 2 and 3 above are omitted entirely (no line/direction exists); the section shows only "Walk to destination — {walkMinutes} min" and the same "Total to destination" summary row. This is the existing DEC-3 behavior, now made explicit for the redesigned layout.
7. **Toll re-entry disclosure (conditional, §5a.4):** if this specific candidate is the round-cap residual case, its disclosure copy renders here, directly under the header row (position: after item 1, before item 3) — see §5a.4 for exact copy and placement rationale.

**Expand/collapse (2026-07-12, new — density management for FR-021's added content):**
- **Card #1 (top pick) is always expanded**, showing the full anatomy above — this is the option most users act on immediately, per §0 principle 6.
- **Cards #2 and #3 (and the single fallback card, §6.5) are collapsed by default**, showing only: rank badge, location name, the headline metric (smaller — `type-body-strong`, not `type-metric`, to keep the visual hierarchy pointing at card #1), and the journey strip (icons only, no per-leg labels). Tapping anywhere on a collapsed card expands it in place to the full anatomy above (items 3-6); tapping again (or a small chevron affordance at the card's right edge) collapses it back.
- This is a legitimate, honest way to satisfy FR-021 for **every** candidate (the full boarding/arrival stop detail is genuinely present and reachable for every card, one tap away — not omitted, not requiring a second screen) while keeping the default screen scan-able now that each card carries meaningfully more content than before. All-expanded-by-default was considered and rejected: with three cards each carrying a full itinerary plus driver/passenger breakdowns, an all-expanded Results screen would be a very long scroll dominated by lower-priority options, undercutting §0 principle 6's "one clear best answer" intent.
- Accessibility: collapsed/expanded is a standard disclosure widget (`aria-expanded`, keyboard-operable, focus-visible per §8) — screen-reader users get the same collapsed-summary-first structure, with the full detail announced on activation, not hidden from the accessibility tree entirely.

**Fallback state (§6.5) and the round-cap disclosure (§5a.4)** both apply the anatomy above unchanged (the fallback's single card is always expanded, same reasoning as card #1 — it's the only option shown, so there's nothing to keep collapsed).

All times rendered as "`N min`" (round to nearest minute; sub-minute precision is not useful to a driver mid-trip). Detour value in the fallback card only (§6.5) is additionally colored `color-danger-text` to draw the eye to the number that's over the threshold.

### 6.4a Excluded-candidate notice — FR-019 (2026-07-12 addition)

Per §0 principle 3 ("never fail silently"), a candidate the user excluded via §5a's toll re-entry question must never simply disappear from the result count with no explanation — a driver who mentally registered "there should be 3 options" and now sees fewer needs to know why, otherwise this reads as a bug, not a result of their own answer.

- Shown only when the Results screen is reached via §5a (i.e., the request path included at least one `confirm-toll-reentry` call with a non-empty `rejectedCandidateLocations`). Never shown on a first-pass search that never triggered §5a at all (the common case) — this is not a generic disclaimer, it only applies to this specific path.
- Position: directly below the disclaimer banner/trip summary and above the fallback warning banner if both are present (fallback and toll-exclusion can co-occur, e.g., excluding a candidate could itself be *why* the search ends in a fallback result).
- Style: a plain informational line, not a warning — `type-body-small`, `color-text-secondary`, no icon, no colored background (this is expected, requested behavior resulting directly from the user's own prior answer, not a problem or a degraded state, so it should not visually compete with the fallback/disclaimer banners' warning styling).
- Copy (count-substituted, singular/plural handled):
  > "1 option was hidden because it exits and re-enters a toll highway during the trip, per your answer."
  > "2 options were hidden because they exit and re-enter a toll highway during the trip, per your answer."
- If the exclusion(s) result in **zero** remaining candidates, this notice is superseded by — not shown alongside — the `no_viable_option` empty state (§6.6), whose own copy should read naturally as a consequence of the search generally (the empty state's existing generic copy already covers this; no toll-specific empty-state variant is introduced, since `no_viable_option`'s trigger reason is not otherwise distinguished in this spec, e.g. "no transit reachable" and "every candidate excluded by your answers" already share the same message treatment).

### 6.4b Transit stop detail on every card — FR-021 (2026-07-12)

This closes the FR-021 gap the addendum previously flagged as not-yet-addressed. Restating where the required data actually lives on the redesigned card (§6.4), since FR-021 is explicit that this applies to **every** displayed candidate, not just the top pick:

- **Boarding stop** (where the passenger gets on transit — FR-021's "drop-off transit stop"): name shown in the "Walk to {boardingStop.name}" row; line name + direction shown in the "Board {lineName} → {headsign}" pill. Both are part of card anatomy item 6 (§6.4) and are present on every expanded card — including collapsed cards #2/#3, one tap away via the expand interaction (§6.4), never omitted or truncated to "top pick only."
- **Arrival stop** (where the passenger gets off transit — FR-021's "destination arrival stop"): name shown in the "Arrive at {arrivalStop.name}" row, same section, same card.
- **Direction of travel**: rendered as the `headsign` value in the boarding pill ("506 → Downtown Loop") — this is the literal FR-021c requirement ("destination-bound headsign or equivalent identifier"), shown inline with the line name rather than as a separate row, since direction is only meaningful in the context of a specific line.
- **Walking-only candidates (DEC-3):** per §6.4's anatomy, both stop rows are correctly and gracefully omitted (no line/direction exists to show) — this is existing, already-approved behavior, not a new gap.
- This satisfies FR-021's "applies uniformly to every candidate shown... not solely the first/highest-ranked one" requirement structurally: the data is part of the one shared card component every rank renders (§6.4), not a top-pick-only addition, so there is no code path where a non-#1 card could render without this data once expanded.

### 6.4c Highway exclusion messaging — FR-020 (2026-07-12, confirms no gap)

FR-020's highway exclusion is confirmed **silent by design — no new UI, no disclosure copy, no messaging surface of any kind added for this spec.** This was flagged as an open question in the prior addendum; resolving it here rather than leaving it as a gap:

- **Reasoning, by analogy to this spec's existing precedent:** FR-011 (fallback) and FR-012 (no viable option) both get explicit user-facing messaging because the exclusion/filtering they represent **changes the outcome the user experiences** in a way they need to understand to trust the result (fewer/worse options than they might expect, or none at all). Highway-excluded points, by contrast, are never viable candidates in the first place — a limited-access highway shoulder is not a place a driver could physically or legally stop, so excluding it doesn't remove an option the user would ever have recognized as a real choice. There is nothing to disclose because there is no forgone option a reasonable user would expect to see.
- **This is consistent with, not a departure from, §6.4a's own reasoning** (the toll-exclusion notice exists specifically because the user made a choice — answering "No" to §5a — that visibly changed their result count; nothing analogous happens here, since the user never made or was asked to make any decision about highway candidates).
- **The one case where this *would* need messaging is already covered:** if highway exclusion happens to remove every raw candidate on a route (leaving zero viable candidates), FR-020's own text confirms this falls under the existing FR-012 "no viable option" handling (§6.6) — the existing generic copy there is sufficient; no highway-specific empty-state variant is introduced, for the same reason no toll-specific one was introduced in §6.4a's closing bullet (the trigger reason for `no_viable_option` is not otherwise distinguished anywhere in this spec).
- **No code/design change follows from this note** — it is a confirmation that the silent-by-design behavior `docs/design.md` §4.2a already implements needs no UI counterpart, closing the tracked gap from the prior addendum's §9.

### 6.5 Fallback state ("closest anyway") — FR-011

Triggered when zero candidates meet the user's detour threshold. Differences from the normal 3-card layout:

- Only **one** card is shown (the single closest-by-passenger-time candidate), not three.
- A warning banner appears above the card (below the disclaimer banner and trip summary), `color-warning-bg`/`color-warning-border`/`color-warning-text`, `type-body-strong`:
  > "None of the drop-off points found keep your detour under {threshold} minutes. Here's the option that gets your passenger there fastest anyway — it adds {actual detour} minutes."
  (Values substituted at render time.)
- The card itself has no "TOP PICK"/rank badge (there was no ranking among qualifying candidates — there were none); instead it's labeled "CLOSEST OPTION" in the same badge position, styled with `color-warning-border` instead of `color-brand-primary` to visually tie it to the warning banner above.
- The "Added detour" row inside the card is rendered in `color-danger-text` to reinforce that this number exceeded what the user asked for.
- Per §6.4's expand/collapse rule, this single card is always expanded (same reasoning as card #1 — it's the only option shown), rendering the full anatomy including FR-021's boarding/arrival stop detail.

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

### 6.7 Map view — FR-022 (2026-07-12: now Google Maps JavaScript API, no longer conditional)

**Status: approved, no longer cost-conditional.** The prior version of this section was gated on tech-lead confirming a Leaflet+non-Google-tile map wouldn't add provider cost; that map shipped (INC-9). FR-022 now reverses that decision — the Results-screen map is being rebuilt on Google's Maps JavaScript API (`docs/design.md` §7.2/§10, INC-10), because Google's pricing model changed such that Dynamic Maps now carries its own separate free allotment, independent of the routing/transit APIs' quota (no more shared-credit risk). The map remains **not required for MVP core flow** — the card-based layout in §6.1–§6.6 is fully self-sufficient without it — but it is now a committed, approved part of the build, not a conditional maybe.

**Functional contract is unchanged from the Leaflet version** (`docs/design.md` §10, INC-10: "same functional contract... rendering-library swap only") — the content/interaction spec below is a light update of the prior section's content, not a rewrite of the interaction model:

- A single map panel sits between the trip summary (§6.3) and the candidate cards (§6.4), full-width, roughly 200-240px tall on mobile, `radius-lg` + `shadow-lg` (§2.4 — the map is one of this screen's two "elevated/primary" surfaces alongside card #1, so it gets the same treatment).
- Content: the driver's route (start → driver's destination) as a line, plus one pin per candidate, labeled with its rank badge ("#1", "#2", "#3") so the map and the cards below use the same visual vocabulary. The rank-1 pin uses `color-brand-primary`; ranks 2-3 use a neutral marker color (`color-text-secondary` equivalent) so the top pick still reads as the emphasized one, consistent with the card highlight in §6.4.
- Tapping a pin scrolls/highlights the corresponding card below (brief `color-bg-surface-raised`-style flash on the card, and if that card is currently collapsed per §6.4's expand/collapse rule, tapping its pin expands it) — tapping a card does not need to re-center the map (keeps interaction one-directional and simple).
- In the fallback state (§6.5, single card), the map shows only that one pin, using the same warning-colored marker (`color-warning-border` equivalent) as the card's "CLOSEST OPTION" badge.
- In the no-viable-option state (§6.6), the "no toll-free route" state (§6.6a), and any error state (§7), the map panel is omitted entirely rather than shown empty — there's nothing meaningful to plot.
- The map is display-only for v1 (no pan/zoom-driven re-querying, no draggable pins) — keeps it a presentation layer over already-computed results, not a new input surface.
- Loading state (§5) is unaffected — the map only ever appears on the Results screen once candidates exist.
- Accessibility: the map is supplementary to the text-based cards, not a replacement — a screen-reader user or a user on a slow connection where the map fails to load must still get the complete, correct picture from the cards alone. If the map script fails to load, fail silently and simply omit the panel (do not show a broken-map placeholder or block the cards from rendering).

**New for FR-022 — Google-specific UX decisions (this pass):**

- **Custom-colored markers, not default red Google pins.** Google's Maps JavaScript API defaults to its standard red teardrop marker for every point, which (a) doesn't distinguish rank and (b) reads as generic/unbranded "raw API" output rather than a considered product surface — the opposite of the "modern, considered" feel this pass is aiming for. Dev implements the rank-1/rank-2-3/fallback marker coloring above using the API's custom marker/icon support (e.g., `AdvancedMarkerElement` with a custom pin glyph/color, or an equivalent custom `Icon`/`Symbol`), not the default marker.
- **Default Google UI chrome is hidden except zoom control.** Google's Maps JavaScript API ships with a substantial default control set (map type toggle, Street View "pegman," fullscreen button, keyboard shortcuts, plus its own zoom control) intended for a general-purpose full-screen map product. This app's map is a small, single-purpose panel showing one route and up to three pins inside a linear results flow — most of that chrome (satellite/terrain toggle, Street View, fullscreen) is irrelevant to this app's one task and would visually compete with the minimal aesthetic this app has had since the original Leaflet+CARTO-Positron treatment. **Decision: initialize the map with `disableDefaultUI: true` and re-enable only the zoom control** (`zoomControl: true`) — the one default control genuinely useful even in a small embedded panel. This preserves the "minimal aesthetic" this spec's design principles have held throughout (§0), rather than accepting Google's full default chrome just because it's the default. The required Google logo/copyright attribution in the map's corner cannot be removed (Google's terms of service) and is not something this spec asks dev to hide.
- **Muted map style, matching the prior CARTO "Positron" light basemap's intent.** Google's default map style renders a high density of labels and points-of-interest (restaurants, shops, transit icons unrelated to this app's own transit data) that would visually compete with this app's own candidate pins and route line. Dev applies a custom Google Maps JS API style (a JSON style array, e.g. reducing POI icon/label visibility and simplifying road/transit-line styling to a light, low-contrast base) so the map reads as a clean backdrop for this app's own markers, preserving the same "quiet basemap, confident foreground markers" relationship the Leaflet version had — this is a styling parameter to the same API call already loading the map, not a new provider call or added cost.
- **Answering the open question directly:** default Google Maps chrome is not simply accepted as-is here, even though the user's own reference points (Google Maps, Waze, Apple Maps) are full native map apps that do show their own chrome — those are standalone navigation apps where the map *is* the whole product; this app's map is a small supporting panel inside a card-based results screen, so a quieter, more custom-branded treatment (hidden default chrome, custom markers, muted style) is the better fit for consistency with the rest of this app's minimal aesthetic, not a departure from the "look modern" mandate — the modernization this pass is going for is in the card/typography/color system (§2, §6.4), not in importing a second product's full UI chrome wholesale.

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
- Color is never the only signal: every warning/error/danger state pairs a color with an icon and/or text, never color alone (relevant for the disclaimer banner, fallback warning, and field errors above). **(2026-07-12)** This now explicitly extends to the new icon set (§2.6) and `color-accent-transit` — every icon and every use of the new transit accent color is always paired with a text label; neither is ever the sole carrier of meaning.
- Minimum body text size 16px; form inputs never smaller than 16px (prevents mobile browser auto-zoom).
- Autocomplete suggestion lists follow ARIA combobox pattern (announced to screen readers, arrow-key navigable).
- **(2026-07-12)** Candidate card expand/collapse (§6.4) is a standard accessible disclosure pattern: `aria-expanded` on the toggle, keyboard-operable (Enter/Space), visible focus ring, and the collapsed state never removes content from the accessibility tree permanently — it is present-but-collapsed, consistent with this being a density/hierarchy choice, not a content-hiding one.

---

## 9. Open UX Questions

All open questions raised across this spec's history — including both items new as of the 2026-07-12 change request — have now been resolved by the user. Nothing in this section blocks build.

**Remaining:**

1. **"Taking longer than expected" threshold (§5):** the exact wait time before the loading screen's copy changes, and the point at which a slow request is treated as a hard failure (§7), should match whatever request timeout tech-lead configures server-side. Needs a config value name/handoff from `docs/design.md`. This is an implementation-detail coordination item, not a UX decision, and does not block Gate 3.

**Resolved (for record):**

1. ~~Candidate location label feasibility~~ — assumed to work via Google Maps Platform reverse geocoding per tech-lead; fallback phrasing specified in §6.4 if tech-lead flags otherwise.
2. ~~Map/visual route view~~ — approved; full spec in §6.7. **(Updated 2026-07-12)** No longer conditional on cost — FR-022 confirmed the Google Maps JavaScript API switch is low-to-zero added cost; §6.7 rewritten accordingly.
3. ~~Detour-input sanity ceiling~~ — resolved: no upper bound, plain numeric input (§4.2).
4. ~~Password gate throttling~~ — resolved: no lockout/rate-limiting, simple inline error only (§3).
5. ~~Product naming/branding~~ — resolved: "DropSpot" selected and applied throughout this spec (§0.0).
6. ~~Undocumented `provider_error` field state (REV-008)~~ — resolved: formally added to §4.1's field-states table as "Lookup failed (provider/network error)"; see Changelog below.
7. **(2026-07-12) Round-cap edge-case behavior for §5a's toll re-entry confirmation** — resolved. The user chose **auto-include at the cap, with a visible per-card disclosure** (previously option (b) in this section's prior draft) over auto-exclude: a candidate that reaches the two-round cap still unconfirmed is included in Results, carrying an honest, explicit disclosure on its card stating its toll re-entry status wasn't confirmed (neither accepted nor rejected) — see §5a.4 for the full resolution and exact disclosure copy, and §6.4 anatomy item 7 for where it renders on the card.
8. **(2026-07-12) FR-020, FR-021, FR-022 UI treatment** — resolved, folded into this pass. FR-020: confirmed silent/no-UI by design, with explicit reasoning now recorded (§6.4c) rather than left as a bare assertion. FR-021: full boarding/arrival stop (name, line, direction) design delivered for every candidate card via the redesigned itinerary-style card (§6.4, §6.4b). FR-022: §6.7 rewritten for Google Maps JavaScript API rendering, including new decisions on custom markers, hidden default chrome, and a muted map style.

---

## 10. Changelog

| Date | Change |
|---|---|
| 2026-07-11 | Added "Lookup failed (provider/network error)" to §4.1's field-states table, closing the traceability gap flagged in review-log.md REV-008. This documents the state dev added during INC-2 for when a geocoding lookup itself fails to complete (network/provider error), distinct from "Unresolvable address" (lookup completed, no match found). Copy: "We couldn't check that address right now. Please try again." Applies to all three location fields (lookup-mechanism failure, not field-specific business logic). User confirmed keeping this addition. |
| 2026-07-12 | **FR-018/FR-019 addendum (toll avoidance checkbox and toll re-entry confirmation flow), status DRAFT pending Gate 3.** Added: §4.2a "Avoid tolls" checkbox on the Input Screen (FR-018), plus its new empty-result outcome, "No toll-free route found" (§6.6a, FR-018/OQ-9). Added new conditional Screen 2a, "Toll Road Check" (§5a, FR-019) — a batched, per-candidate confirmation interstitial shown between Loading and Results only when the search response flags one or more final candidates with a toll-road exit/re-entry pattern; resolves tech-lead's explicitly-flagged open interaction-model question (`docs/design.md` §1.4/§4.6) in favor of a conditional interstitial (not an upfront Input-Screen question, not an inline Results-screen prompt), batched presentation with per-candidate (not whole-trip) answers, and a hard two-round cap matching tech-lead's stateless/bounded-round-trip design intent. Added §6.4a, the excluded-candidate notice on Results, so a candidate the user rejected via §5a never simply vanishes without explanation (§0 principle 3). Updated §1's screen inventory table and flow line, and §5's Loading screen (§5.1) to note its reuse (with swapped copy) during toll re-entry re-computation. Flagged one genuine open question in §9 (round-cap residual edge case — auto-exclude vs. auto-include-with-disclosure) for tech-lead/user rather than resolved unilaterally, and explicitly noted FR-020/FR-021/FR-022 UI treatment remains outside this addendum's scope, tracked as a known gap. | Designer task, part of the FR-018–FR-022 change request (`docs/requirements.md` FR-018/FR-019, approved 2026-07-12; `docs/design.md` §1.4/§4.6, DRAFT pending user approval). Tech-lead deliberately left the FR-019 interaction model as a genuine UX decision rather than presenting a finalized contract, recommending only the underlying stateless two-endpoint mechanism (batch-ask-once, one bounded confirm round-trip) for cost/latency reasons — this entry is designer's resolution of that flagged decision. |
| 2026-07-11 | **Closes REV-015.** Resolved the §6.2/§6.6 disclaimer-scope ambiguity the reviewer flagged: §6.6's `no_viable_option` mockup previously showed the disclaimer banner present with an annotation ("harmless, consistent — no reason to hide it") that conflicted with design.md §5.2's narrower `candidates.length > 0` contract and the shipped INC-7 code. **Decision: the disclaimer is scoped to `ranked`/`fallback` only** (states that show a suggested drop-off point) and is explicitly **not** shown on `no_viable_option`, `out_of_service_area`, `invalid_input`, or `timeout`/system-failure states. Rationale: the disclaimer's purpose is to caution the driver about a *specific suggested point* before using it (§0 principle 2); a state with no point on screen has nothing to caution about. This choice matches the already-implemented behavior — no code change required. §6.2 now states this scope explicitly; §6.6's mockup no longer shows the banner and its annotation is superseded. Designer judgment call, not escalated to the user (reviewer confirmed no candidate is ever shown without the disclaimer under either reading, so no safety exposure was at stake either way). |
| 2026-07-12 | **Round-cap edge-case resolution (§5a.4) + full UI modernization pass (change-request item 5) + FR-020/FR-021/FR-022 designer treatment. Status: FINAL, no open designer gaps remain.** Two pieces of work in this entry: **(1) Round-cap resolution:** the user decided the former §9 open question — when §5a's two-round confirmation cap is reached with a candidate still unconfirmed, that candidate is **auto-included in Results with a visible per-card disclosure**, not auto-excluded. Updated §5a.4 with the resolution and exact disclosure copy ("This option uses a toll highway that exits and re-enters during the trip. We weren't able to ask you about it — your answer for the other option(s) doesn't apply here."), added a row to §5a.5's states table, added card anatomy item 7 in §6.4, and moved the item from §9's "Remaining" to "Resolved" list. **(2) UI modernization pass**, addressing the user's direct feedback that the app should feel modern (referencing Google Maps/Waze/Apple Maps) and that "Walk to stop"/"Wait + transit" candidate-card labels were confusing, plus folding in FR-021 (transit stop/line/direction display) and FR-022 (Google Maps JS API rendering) UI design, which the prior addendum had explicitly left as a tracked gap: Added two new design principles (§0.5 plain-language-over-jargon, §0.6 confident-visual-hierarchy). Revised the visual system (§2): new `color-bg-surface-sunken`, `color-accent-transit`/`color-on-accent-transit` tokens; new `type-metric`/`type-h3` type tokens and narrowed `type-label`'s scope off candidate-card subsection headers; `radius-md` increased 8px→12px, new `radius-lg` (20px) for "primary/elevated" surfaces, `radius-full` extended to all primary CTA buttons (previously `radius-md`); new `shadow-lg` token; new §2.6 Iconography section defining a minimal icon vocabulary (walking figure, transit-mode glyph, car, pin, flag) with a strict "never icon-alone" rule. Applied lighter modernization touches to the Password Gate (§3, icon badge, pill CTA), Input Screen (§4, a connected "stops on a route" vertical timeline linking the three location fields, matching the Google Maps/Waze trip-planner convention), and Loading screen (§5, replaced the static secondary line with a 3-stage stepped status list for a more active/specific waiting experience). **Fully redesigned the candidate card (§6.4)** — the core of this pass: replaced the flat driver/passenger label-value row list with a headline passenger-total metric (`type-metric`), a glanceable icon-based journey strip, and an itinerary-style passenger section that names the actual boarding/arrival stops and shows the transit line + direction as a colored pill rather than a bare "Wait + transit" row — this directly fixes the flagged confusing labels (full old-label → new-treatment rationale table included in §6.4) and gives FR-021's newly-required boarding/arrival stop detail (name, line, direction, for both stops, on every candidate) a natural home rather than bolting it on as more rows. Renamed "BEST OPTION" → "TOP PICK" (§6.4, §6.5) and gave card #1 `radius-lg`/`shadow-lg` elevation. Added an **expand/collapse mechanism** (card #1 always expanded; cards #2/#3 and the fallback card collapsed-by-default, showing a compact summary, one tap from full detail) to manage the added information density from FR-021 without abandoning §0.6's "one clear best answer" hierarchy — considered and rejected showing all cards fully expanded by default, which would have produced an overlong, undifferentiated scroll. Added new §6.4b, explicitly mapping FR-021's boarding/arrival-stop/line/direction requirements onto the redesigned card and confirming the data is present (one tap away) on every rank, not only #1. Added new §6.4c, confirming FR-020 (highway exclusion) remains silent-by-design with no new messaging, reasoned explicitly by analogy to why FR-011/FR-012 *do* get messaging (an outcome the user needs to understand) versus FR-020 (never a real option in the first place) — closes the tracked gap without adding UI. Fully rewrote §6.7 for FR-022: no longer a cost-conditional "if included" section — Google Maps JavaScript API rendering is approved and committed; added explicit decisions on replacing default red pins with custom rank-colored markers, hiding Google's default UI chrome except zoom control (`disableDefaultUI: true` + `zoomControl: true`) to preserve this app's minimal aesthetic rather than accepting Google's full general-purpose chrome, and applying a custom muted map style so POI clutter doesn't compete with this app's own pins/route — directly answering the flagged question of whether default Google chrome is acceptable given the Google Maps/Waze/Apple Maps reference (answer: no, because this is a supporting panel inside a card-based results screen, not a standalone full-screen navigation app). Updated §8 (accessibility notes for the new icon/accent-color pairing rule and the expand/collapse disclosure pattern) and §9 (both former open questions now fully resolved, moved to the "Resolved" list; §9's framing rewritten to reflect there are no remaining designer gaps from the 2026-07-12 change request). Updated the document's top status line accordingly. | User directly requested (a) resolution of the round-cap open question, choosing auto-include-with-disclosure over auto-exclude, and (b) a full UX modernization audit referencing Google Maps/Waze/Apple Maps, explicitly citing "Walk to stop"/"Wait + transit" as confusing — this is change-request item 5 (`docs/requirements.md`, "full UX audit/redesign mandate... routed to designer, no FR of its own"). FR-021/FR-022 UI treatment was explicitly flagged as an outstanding designer gap in the prior addendum (§9, resolved item 8 above) and folded into this same pass since both touch the same screens (Results/candidate card, map) this audit was already revising. |
