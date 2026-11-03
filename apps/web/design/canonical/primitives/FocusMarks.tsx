/* The one D2KIRO focus form. The 2 px ink ring (outline, set in primitives.css) carries WCAG; these
   four corner brackets (Round 3B Skin B language) and the 4 px cyan node carry identity. Shown only on
   :focus-visible (or a forced `data-state="focus"` specimen that uses the very same rule). */
export function FocusMarks() {
  return (
    <span aria-hidden="true" className="cx-focus">
      <i />
      <i />
      <i />
      <i />
      <b />
    </span>
  );
}
