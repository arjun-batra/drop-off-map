# UX Spec: Drop-off Point Optimizer

Status: DRAFT — for Gate 3 review alongside `docs/design.md`.
Source: `docs/idea-brief.md`, `docs/requirements.md` (both approved).
Owner: designer. Do not edit outside this agent.

## 0. Design Principles

1. **Mobile-first, single-column, single-flow.** No navigation menu, no accounts, no dashboard — this is a linear tool: enter trip → wait → read results. Every screen in this spec is a step in that one flow.
2. **Say the estimate is an estimate, loudly.** The safety/legality disclaimer (FR-014) is a first-class, persistent UI element, not fine print. It is never rendered as a dismiss-once toast or a collapsed tooltip.
3. **Never fail silently.** Every place the system could show nothing (bad address, out of area, no transit, provider timeout) has an explicit, specific message. Generic "Something went wrong" is the last resort, not the default.
4. **Fast-feeling, not just fast.** Given the 5s target (NFR-004) with live external calls, the loading state must communicate real progress/context so 3-5 seconds does not feel stalled.

## 1. Screen Inventory (mapped to FRs)

| # | Screen | Shown when | FR/NFR coverage |
|---|---|---|---|
| 0 | Password Gate | `APP_MODE = paid_tier` | FR-016, FR-017 |
| 1 | Input Screen | Always, first screen after gate (or app entry in free-tier mode) | FR-001, FR-002, FR-003, FR-004, FR-015 |
| 2 | Loading State | After valid submit, while awaiting results | NFR-004 |
| 3 | Results Screen | On successful computation | FR-005–FR-014 |
| 4 | Edge/Error States | Out-of-radius, unresolvable address, no viable route, system failure | FR-003, FR-004, FR-011, FR-012 |

Flow: `[Password Gate]` (conditional) → `Input` → `Loading` → `Results` **or** `Error state` (with a path back to `Input`).

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
│      Drop-off Point Finder         │
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

No lockout/throttling is specified here (NFR-007 exempts abuse protection from v1 scope generally); see Open Questions.

---

## 4. Screen 1 — Input Screen

Single form, four fields, in this order. All fields required before "Find drop-off points" is enabled.

```
┌───────────────────────────────────┐
│  Drop-off Point Finder             │  type-h1
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
| Outside service area (FR-004) | `color-danger-border` | Inline `type-body-small`, `color-danger-text`, under the field: "This location is outside our service area (within `GEOGRAPHIC_RADIUS_KM` of `GEOGRAPHIC_CENTER`). We don't support this area yet." — copy renders with the actual configured radius/center substituted, e.g. "within 200 km of Toronto." |

Validation timing: address resolution and radius checks run as soon as a suggestion is selected or "use current location" completes — not deferred to submit — so the user sees the specific field's problem immediately, before trying to submit.

### 4.2 Max acceptable detour field — FR-002

- Numeric input, unit "minutes" shown as a suffix label inside/next to the field (e.g., "10 min").
- Required. Client-side validation:
  - Empty on submit attempt → inline error, `color-danger-text`: "Enter a maximum detour time in minutes."
  - Non-numeric or ≤ 0 → inline error: "Enter a number greater than 0."
  - No upper bound is enforced (none specified in requirements) — see Open Questions §7.1 on whether a sanity-check ceiling is wanted.

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
- This banner is present on every results state, including the fallback state and, if applicable, is the one non-negotiable element that must render even if other rendering fails.

### 6.3 Trip summary + "Edit search"

- `type-body-small`, `color-text-secondary`. Shows resolved (not raw-typed) addresses for orientation: "Your trip: {start} → {your destination}" / "Passenger to: {passenger destination}".
- "← Edit search" is a text link, `color-brand-primary`, returns to Input screen with all four values preserved from the just-completed search (in-memory only).

### 6.4 Candidate cards — FR-006, FR-010, FR-013

Ordered top to bottom by rank (ascending passenger total time per FR-010). Each card:

- Rank badge: "#1", "#2", "#3" — `type-label` in a `radius-full` pill.
- Card #1 only: additional "BEST OPTION" label next to the rank badge, and `color-bg-surface-raised` background + `color-brand-primary` left border accent, to visually distinguish the top recommendation. (This is a presentation emphasis on already-ranked data — not new logic. Ranking/order itself comes entirely from FR-010; the visual highlight is UX-only.)
- Location header: best available resolved description of the drop-off point (e.g., nearest cross-street or reverse-geocoded address) — `type-h2`. Exact data available for this label depends on the routing/geocoding provider tech-lead selects; see Open Questions §7.2.
- Two labeled sub-sections, "DRIVER" and "PASSENGER" (`type-label`, `color-text-secondary`), each a simple two-column row list (label left, value right, `type-body` for labels / `type-body-strong` for the values):
  - Driver: Drive to drop-off (FR-006a), Added detour (FR-006b, prefixed with "+"), Your total trip (FR-006f).
  - Passenger: Walk to stop (FR-006c), Wait + transit (FR-006d), Total to destination (FR-006e).
- All times rendered as "`N min`" (round to nearest minute; sub-minute precision is not useful to a driver mid-trip). Detour value in the fallback card only (6.5) is additionally colored `color-danger-text` to draw the eye to the number that's over the threshold.

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
│ ⚠ This is an estimated drop-off …  │  disclaimer still shown (harmless,
├───────────────────────────────────┤   consistent — no reason to hide it)
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

Note this is distinct from the out-of-radius case (Screen 1, §4.1), which blocks earlier at input time and never reaches computation.

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

## 9. Open UX Questions (need tech-lead and/or user input before or during Gate 3)

1. **Candidate location label (§6.4):** the spec assumes each result can be labeled with a human-readable address or nearest cross-street. This depends on what the chosen routing/geocoding provider returns for an arbitrary point along a route. Tech-lead: please confirm feasibility, or this label design needs revisiting (e.g., fall back to lat/long or distance-along-route phrasing).
2. **Map/visual route view:** this spec is text/card-only (no FR requires a visual map). A map thumbnail showing the route and the three candidate pins would likely improve trust/usability but adds provider/rendering scope not currently in the FRs. Flagging as a possible enhancement for the user/tech-lead to explicitly accept or defer, not assuming it in.
3. **"Taking longer than expected" threshold (§5):** the exact wait time before the loading screen's copy changes, and the point at which a slow request is treated as a hard failure (§7), should match whatever request timeout tech-lead configures server-side. Needs a config value name/handoff from design.md.
4. **Detour-input sanity ceiling (§4.2):** requirements set no upper bound on the minutes value. Should the UI cap or warn on clearly unreasonable entries (e.g., 10,000 minutes), or is unbounded acceptable for v1? No FR speaks to this either way.
5. **Password gate throttling (§3):** no lockout/rate-limit is specified for repeated wrong-password attempts (NFR-007 defers abuse protection generally, but that NFR is written about free-tier usage, not explicitly the password gate itself). Confirm with user/pm whether basic throttling is wanted for the gate specifically, or whether it's accepted as out of scope like the rest of abuse protection.
6. **Product naming/branding:** "Drop-off Point Finder" is a placeholder title used throughout this spec. No product name was specified in idea-brief/requirements — confirm actual name/branding with the user, or accept the placeholder for v1.
