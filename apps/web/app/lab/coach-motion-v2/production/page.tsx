import type { Metadata } from "next";
import { CoachProductionLab } from "@/features/coach-motion/CoachProductionLab";
import { parseProductionParams } from "@/features/coach-motion/production-params";

export const metadata: Metadata = {
  title: "D2KIRO Coach Motion V2 production slice (Lab)",
  robots: { index: false, follow: false },
};

/* Production-candidate slice: LIVE Gold Master vs the 384 and 512 px Motion V2 packs (WATCHING loop, WATCHING -> ANALYZING, ANALYZING loop). Not linked, not product. */
export default async function CoachMotionProductionPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <CoachProductionLab {...parseProductionParams(await searchParams)} />;
}
