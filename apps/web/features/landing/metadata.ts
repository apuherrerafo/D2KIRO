/* LANDING-01B · page metadata for the public route. Specific to the product, no marketing claims. */
import type { Metadata } from "next";

const TITLE = "D2KIRO — Draft coach for Dota 2";
const DESCRIPTION = "D2KIRO reads your Dota 2 draft and shows one call with the evidence beside it, read against how you play. Early access by email.";

export const LANDING_METADATA: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: { title: TITLE, description: DESCRIPTION, type: "website", siteName: "D2KIRO" },
};
