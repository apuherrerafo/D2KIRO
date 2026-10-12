import type { Metadata } from "next";
import { HeroLoopLab } from "@/features/hero-loop/HeroLoopLab";
import { parseHeroLoopParams } from "@/features/hero-loop/lab-params";

export const metadata: Metadata = {
  title: "D2KIRO Hero Loop (Lab)",
  robots: { index: false, follow: false },
};

/* Isolated lab route (R&D). Not linked from the nav and not wired into the production Landing. */
export default async function HeroLoopPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <HeroLoopLab {...parseHeroLoopParams(await searchParams)} />;
}
