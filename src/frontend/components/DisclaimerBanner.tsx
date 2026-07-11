import { DISCLAIMER_TEXT } from "../../search/types";
import "./DisclaimerBanner.css";

/**
 * FR-014's persistent, non-dismissible safety/legality disclaimer banner
 * (ux-spec.md section 6.2). Resolves REV-012.
 *
 * Deliberately a static, prop-less component: it has zero dependency on
 * response/candidate data of any kind (not even a boolean), so nothing about
 * *this* component's own render logic can throw or produce blank/incorrect
 * output because of malformed upstream data. ux-spec.md section 6.2
 * explicitly requires this banner to "render even if other rendering
 * fails" -- see SearchFlow.tsx for how this component is kept structurally
 * isolated (rendered as a sibling outside an ErrorBoundary that wraps the
 * rest of the Results screen) so a crash anywhere in ResultsScreen's
 * data-dependent rendering can never take this banner down with it.
 *
 * No dismiss control of any kind (non-dismissible per FR-014/ux-spec.md).
 */
export function DisclaimerBanner() {
  return (
    <div className="disclaimer-banner type-body-strong" role="alert">
      <span className="disclaimer-banner__icon" aria-hidden="true">
        ⚠
      </span>
      <span>{DISCLAIMER_TEXT}</span>
    </div>
  );
}
