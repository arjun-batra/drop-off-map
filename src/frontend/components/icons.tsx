/**
 * Minimal, purposeful icon set -- ux-spec.md section 2.6 (new, 2026-07-12
 * modernization pass), introduced in INC-12 for the redesigned candidate
 * card (section 6.4). Every icon here is decorative only (`aria-hidden`) --
 * per section 2.6's own rule and section 8's accessibility note, an icon is
 * never the sole carrier of meaning in this app; every usage site pairs it
 * with a visible text label, so no icon needs its own accessible name.
 *
 * Sizes map to the `--icon-size-sm/md/lg` tokens (ux-spec.md section 2.6)
 * via a `size` prop rather than a literal pixel value in each call site.
 */

export type IconSize = "sm" | "md" | "lg";

interface IconProps {
  size?: IconSize;
  className?: string;
}

function sizeVar(size: IconSize): string {
  return `var(--icon-size-${size})`;
}

/** Walking figure -- a walking leg of the journey (ux-spec.md section 2.6). */
export function WalkIcon({ size = "md", className }: IconProps) {
  const px = sizeVar(size);
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={className}
      style={{ width: px, height: px }}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="13" cy="4" r="2" fill="currentColor" stroke="none" />
      <path d="M10 8l3 1 3 4-2 2 1 6" />
      <path d="M13 9l-4 2-2 5" />
      <path d="M12 13l-3 3 1 4" />
    </svg>
  );
}

/**
 * Generic transit (bus/train) glyph. ux-spec.md section 2.6 allows a
 * mode-specific glyph "if the transit provider's mode is known," but
 * `TransitStopDetail` (design.md section 5.1) carries no vehicle-type
 * field -- only line name/headsign -- so a single generic glyph is used
 * uniformly, per the section's own documented fallback.
 */
export function TransitIcon({ size = "md", className }: IconProps) {
  const px = sizeVar(size);
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={className}
      style={{ width: px, height: px }}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="3" width="16" height="13" rx="2" />
      <path d="M4 11h16" />
      <circle cx="8" cy="17.5" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="16" cy="17.5" r="1.5" fill="currentColor" stroke="none" />
      <path d="M7 20l-1.5 2M17 20l1.5 2" />
    </svg>
  );
}

/** Car -- the driver's leg (ux-spec.md section 2.6). */
export function CarIcon({ size = "md", className }: IconProps) {
  const px = sizeVar(size);
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={className}
      style={{ width: px, height: px }}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 16l1.5-5A2 2 0 0 1 7.4 9.5h9.2a2 2 0 0 1 1.9 1.5L20 16" />
      <rect x="3" y="16" width="18" height="4" rx="1.5" />
      <circle cx="7.5" cy="20" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="16.5" cy="20" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Checkered-flag-style glyph -- final arrival at the passenger's destination (ux-spec.md section 2.6). */
export function FlagIcon({ size = "md", className }: IconProps) {
  const px = sizeVar(size);
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={className}
      style={{ width: px, height: px }}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 21V4" />
      <path d="M6 4h11l-2.5 3.5L17 11H6" />
    </svg>
  );
}

/** Chevron -- collapsed/expanded disclosure affordance (ux-spec.md section 6.4). Not itself in section 2.6's icon table, but the same purely-decorative treatment applies. */
export function ChevronIcon({ size = "sm", className, expanded }: IconProps & { expanded: boolean }) {
  const px = sizeVar(size);
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        width: px,
        height: px,
        transform: expanded ? "rotate(180deg)" : "none",
        transition: "transform 150ms ease",
      }}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
