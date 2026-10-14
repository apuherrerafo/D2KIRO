/* LANDING V3 · the page's four typefaces, self-hosted by next/font at build time (no request to Google at runtime).
   Syne = display, Bricolage Grotesque = UI, IBM Plex Sans = reading, IBM Plex Mono = labels and figures. */
import { Bricolage_Grotesque, IBM_Plex_Mono, IBM_Plex_Sans, Syne } from "next/font/google";

const syne = Syne({ subsets: ["latin"], variable: "--font-syne", display: "swap" });
const bricolage = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-bric", display: "swap" });
const plexSans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-sans", display: "swap" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["500", "600"], variable: "--font-plex-mono", display: "swap" });

export const LANDING_FONT_CLASSES = [syne, bricolage, plexSans, plexMono].map((font) => font.variable).join(" ");
