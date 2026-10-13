import type { Metadata } from "next";
import { CoachMotionLab } from "@/features/coach-motion/CoachMotionLab";
import { parseCoachMotionParams } from "@/features/coach-motion/lab-params";

export const metadata: Metadata = {
  title: "D2KIRO Coach Motion V2 (Lab)",
  robots: { index: false, follow: false },
};

/* Isolated micro-prototype (R&D): CURRENT sprite vs LIVE Gold Master vs MOTION V2 prerendered atlas. Not linked, not product. */
export default async function CoachMotionV2Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <CoachMotionLab {...parseCoachMotionParams(await searchParams)} />;
}
