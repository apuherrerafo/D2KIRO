/* D2KIRO project cockpit data. Hand-edited estimate; not an automated forecast. */
export type Status = "LOCKED" | "APPROVED" | "IN REVIEW" | "PENDING" | "BLOCKED";

export interface StatusCard {
  name: string;
  status: Status;
  progress: number;
  note: string;
}

export const PROJECT_STATUS = {
  project: "LANDING V2",
  overall: 89,
  overallLabel: "READY FOR PRODUCTION",
  currentGate: "Promotion prep",
  next: ["Content sign-off", "Real iPhone QA", "Nav / routing", "Staging", "Production"],
  cards: [
    { name: "Hero Loop", status: "LOCKED", progress: 100, note: "V1.1 · d24da56" },
    { name: "Memory", status: "LOCKED", progress: 100, note: "Physics V1.1 · scroll coupling passed final product gate" },
    { name: "Counterfactual", status: "LOCKED", progress: 100, note: "V1 · 6fc9cc2" },
    { name: "Coach", status: "LOCKED", progress: 100, note: "Pre-rendered sprites, desktop + mobile" },
    { name: "Landing V2", status: "LOCKED", progress: 100, note: "Product direction locked · promotion prep" },
    { name: "Dark / Light", status: "IN REVIEW", progress: 95, note: "Integrated" },
    { name: "Mobile", status: "IN REVIEW", progress: 85, note: "WebKit validated; real iPhone smoke pending" },
    { name: "Performance", status: "APPROVED", progress: 95, note: "4.33 MB desktop · 4.34 MB mobile · JS 0.80 MB · 0 long tasks" },
    { name: "Dota Sign-off", status: "PENDING", progress: 55, note: "DOTA_SIGNOFF + CF_SIGNOFF + Memory hypotheses" },
    { name: "Production", status: "PENDING", progress: 40, note: "Nav, iPhone QA, routing/waitlist, staging, deploy" },
  ] as StatusCard[],
  openBeforeProduction: [
    "Dota/content sign-off",
    "Real iPhone smoke",
    "Mobile Nav decision / show-through",
    "Hero Draft 2 vocabulary cleanup (\"Few games\" / \"In your pool\")",
    "Memory label collisions (desktop \"Heroes you return to\", mobile \"You · Mid\")",
    "Production routing",
    "Waitlist production behaviour",
    "Staging smoke",
    "Production promotion",
  ],
  time: [
    { label: "BEST CASE", value: "~1 focused day" },
    { label: "WITH QA FIXES", value: "~1–2 extra days" },
  ],
  timeDisclaimer: "Manual estimate, not an automated forecast.",
  milestones: [
    { title: "Hero Loop locked", detail: "d24da56" },
    { title: "Counterfactual locked", detail: "6fc9cc2" },
    { title: "Landing V2 integrated" },
    { title: "Landing V2 product direction locked" },
    { title: "Three.js removed from Landing V2" },
    { title: "Desktop weight", detail: "12.92 MB → 4.33 MB" },
    { title: "JS", detail: "1.63 MB → 0.80 MB" },
    { title: "Long tasks", detail: "43 → 0" },
  ] as { title: string; detail?: string }[],
  changedSinceLastReview: [
    "Landing V2 switched fully to pre-rendered Coach",
    "Desktop payload dropped significantly",
    "Three.js removed from Landing runtime",
    "Memory scroll coupling fixed; Final guaranteed before the Memory exit",
    "Landing V2 locked; promotion prep is the active gate",
  ],
};
