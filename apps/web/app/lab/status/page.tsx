import type { Metadata } from "next";
import { StatusPage } from "@/features/project-status/StatusPage";

export const metadata: Metadata = {
  title: "D2KIRO Project Cockpit (Lab)",
  robots: { index: false, follow: false },
};

/* Internal status page. Not linked from the nav; production `/` is untouched. */
export default function Page() {
  return <StatusPage />;
}
