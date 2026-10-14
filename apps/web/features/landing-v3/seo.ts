/* LANDING V3 · metadata and structured data. The FAQPage JSON-LD is generated from the SAME items the page renders, so the markup
   can never drift from what the visitor reads. */
import type { Metadata } from "next";
import { FAQ, SITE } from "./copy";

export const LANDING_V3_METADATA: Metadata = {
  title: SITE.title,
  description: SITE.description,
  alternates: { canonical: "/" },
  openGraph: { title: SITE.title, description: SITE.description, type: "website", siteName: SITE.name },
};

export interface FaqJsonLd {
  "@context": "https://schema.org";
  "@type": "FAQPage";
  mainEntity: Array<{ "@type": "Question"; name: string; acceptedAnswer: { "@type": "Answer"; text: string } }>;
}

export function faqJsonLd(items: ReadonlyArray<{ q: string; a: string }> = FAQ.items): FaqJsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({ "@type": "Question", name: item.q, acceptedAnswer: { "@type": "Answer", text: item.a } })),
  };
}

/** JSON for a <script type="application/ld+json">. `<` is escaped so no answer text can ever close the tag. */
export function jsonLdString(data: FaqJsonLd): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
