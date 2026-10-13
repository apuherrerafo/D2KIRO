import type { Metadata } from "next";
import { LandingV2 } from "@/features/landing-v2/LandingV2";
import { parseLandingV2Params } from "@/features/landing-v2/lab-params";

export const metadata: Metadata = {
  title: "D2KIRO Landing V2 (Lab)",
  robots: { index: false, follow: false },
};

/* Integration candidate (R&D). Not linked from the nav; production `/` remains Landing 01B. */
export default async function LandingV2Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <LandingV2 {...parseLandingV2Params(await searchParams)} />;
}
