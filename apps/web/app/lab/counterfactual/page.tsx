import type { Metadata } from "next";
import { CounterfactualLab } from "@/features/counterfactual-lab/CounterfactualLab";
import { parseCounterfactualParams } from "@/features/counterfactual-lab/lab-params";

export const metadata: Metadata = {
  title: "D2KIRO Counterfactual (Lab)",
  robots: { index: false, follow: false },
};

/* Isolated lab route (R&D). Not linked from the nav and not wired into the production Landing. */
export default async function CounterfactualPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <CounterfactualLab {...parseCounterfactualParams(await searchParams)} />;
}
