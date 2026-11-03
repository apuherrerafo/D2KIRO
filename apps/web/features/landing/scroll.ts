/* LANDING-01B · in-page navigation. Smooth scroll is motion, so reduced motion jumps instead. */
export function scrollToId(id: string, reducedMotion: boolean) {
  const target = document.getElementById(id);
  if (!target) return;
  target.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
  target.focus({ preventScroll: true });
}
