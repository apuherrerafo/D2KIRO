import type { Metadata } from "next";
import { CoachMotionEval } from "@/features/coach-motion/CoachMotionEval";

export const metadata: Metadata = {
  title: "D2KIRO Coach Motion V2 eval (Lab)",
  robots: { index: false, follow: false },
};

/* Evaluation harness for the Coach Motion V2 production-format study. Not linked, not product. */
export default function CoachMotionEvalPage() {
  return <CoachMotionEval />;
}
