import { FOOTER } from "../copy";

export function LandingFooter() {
  return (
    <footer className="ld-footer">
      <div className="ld-wrap ld-footer-row">
        <span className="ld-wordmark">D2KIRO</span>
        <p className="ld-legal">{FOOTER.notAffiliated}</p>
      </div>
    </footer>
  );
}
