import { StatusNotice } from "@/design/components";

const meta = {
  title: "Design System/StatusNotice",
  component: StatusNotice,
};

export default meta;

export function Neutral() {
  return (
    <div className="w-[480px]">
      <StatusNotice title="Draft Synchronized">
        Hero pool and engine capabilities are fully synchronized.
      </StatusNotice>
    </div>
  );
}

export function Warning() {
  return (
    <div className="w-[480px]">
      <StatusNotice title="Limited Evidence" tone="warning">
        Sample size for this hero matchup is low. Review tactical synergy before locking.
      </StatusNotice>
    </div>
  );
}

export function Error() {
  return (
    <div className="w-[480px]">
      <StatusNotice title="Engine Disconnected" tone="error">
        Connection to recommendation engine lost. Retrying in background.
      </StatusNotice>
    </div>
  );
}

export function LongContent() {
  return (
    <div className="w-[480px]">
      <StatusNotice title="Draft Context Review Required" tone="warning">
        This notice tests line wrapping and typography hierarchy under extended content.
        The layout must maintain sufficient readability, distinct title weighting, and
        accessible contrast without overflowing the container bounds or obstructing
        the primary draft decision.
      </StatusNotice>
    </div>
  );
}
