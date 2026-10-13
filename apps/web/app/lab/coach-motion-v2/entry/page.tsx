import type { Metadata } from "next";
import { CoachMotionEntryLab } from "@/features/coach-motion/CoachMotionEntryLab";
import type { EntryStrategy } from "@/features/coach-motion/entry-plan";

export const metadata: Metadata = {
  title: "D2KIRO Coach Motion V2 entry phase (Lab)",
  robots: { index: false, follow: false },
};

type Raw = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/* Entry-phase study for the Coach Motion V2 production-format work: canonical vs phase-aligned entries. Not linked, not product. */
export default async function CoachMotionEntryPage({ searchParams }: { searchParams: Promise<Raw> }) {
  const params = await searchParams;
  const pack = first(params.pack) === "C" ? "C" : "A";
  const only = (["canonical", "nearest", "wait"] as const).find((s) => s === first(params.only)) ?? null;
  const stride = Number(first(params.stride)) === 12 ? 12 : 6;
  return <CoachMotionEntryLab only={only as EntryStrategy | null} pack={pack} stride={stride} theme={first(params.theme) === "light" ? "light" : "dark"} />;
}
