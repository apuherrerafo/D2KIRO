import type { Metadata } from "next";
import { CoachFullPackLab } from "@/features/coach-motion/CoachFullPackLab";

export const metadata: Metadata = {
  title: "D2KIRO Coach Motion V2 full semantic pack (Lab)",
  robots: { index: false, follow: false },
};

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/* Full semantic pack review: LIVE Gold Master vs the 384 px Motion V2 pack (WATCHING, ANALYZING, POINTING, CONFIRMING and their five edges). ?theme=light|dark · ?live=0 (Motion V2 panel only). Not linked, not product. */
export default async function CoachMotionFullPackPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  return <CoachFullPackLab live={first(params.live) !== "0"} theme={first(params.theme) === "light" ? "light" : "dark"} />;
}
