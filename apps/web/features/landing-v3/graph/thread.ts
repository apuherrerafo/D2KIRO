/* LANDING V3 · the lime thread: it leaves the graph's ranking column at beat 6 and runs into the Payoff card.
   Both ends are lined up in screen space from the stage's own geometry, so it survives any viewport. Wide stage only. */
import { clamp } from "./model";
import type { Stage } from "./stage";

export function alignThread(stage: Stage, stick: HTMLElement | null): void {
  const column = stage.column();
  const wrap = document.getElementById("payoff-wrap");
  const line = document.getElementById("payoff-line");
  const card = document.getElementById("pay-card");
  if (!column || !stick || !wrap || !line || !card) return;
  if (window.matchMedia("(max-width: 820px)").matches) return;
  const stickRect = stick.getBoundingClientRect();
  const wrapRect = wrap.getBoundingClientRect();
  stick.style.setProperty("--lx", `${column.x - stickRect.left}px`);
  stick.style.setProperty("--dt", `${clamp(column.bottom - stickRect.top, 0, stickRect.height)}px`);
  line.style.setProperty("--plx", `${column.x - wrapRect.left}px`);
  line.style.setProperty("--lh", `${card.getBoundingClientRect().top - wrapRect.top}px`);
}
