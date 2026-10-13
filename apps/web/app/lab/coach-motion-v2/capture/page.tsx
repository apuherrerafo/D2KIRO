import type { Metadata } from "next";
import { CoachMotionCapture } from "@/features/coach-motion/CoachMotionCapture";

export const metadata: Metadata = {
  title: "D2KIRO Coach Motion V2 capture (Lab)",
  robots: { index: false, follow: false },
};

/* Offline capture harness for the Coach Motion V2 micro-prototype. Not linked, not product. */
export default function CoachMotionCapturePage() {
  return <CoachMotionCapture />;
}
