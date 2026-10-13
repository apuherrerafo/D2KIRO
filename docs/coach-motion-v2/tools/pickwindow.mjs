import { readFileSync } from "node:fs";
import { OUT } from "./lib.mjs";
const P = JSON.parse(readFileSync(OUT + "/idle-pose-scan.json", "utf8"));
const N = 60, W = 2.0;
// cost of looping forward: pose distance between window start and window end (px-ish weights), + blink exclusion
const wt = { yaw: 90, pitch: 90, squash: 160, shardSpin: 110, eyeOpen: 40, eyeX: 60, eyeZ: 60, lean: 200, shardRadius: 110 };
const d = (a, b) => Math.sqrt(Object.keys(wt).reduce((s, k) => s + (wt[k] * (a[k] - b[k])) ** 2, 0));
const rows = [];
for (let i = 0; i + 60 <= P.length - 1; i++) {
  const win = P.slice(i, i + 60);
  const blink = Math.min(...win.map((q) => q.eyeOpen));
  const end = P[i + 60];
  // endpoint speed (px-ish per frame) at both ends: smoothness of a ping-pong turn
  const v0 = d(P[i + 1], P[i]), v1 = d(P[i + 60], P[i + 59]);
  const range = Math.max(...win.map((q) => d(q, P[i])));
  rows.push({ c0: P[i].t, blink, seam: d(end, P[i]), v0, v1, range });
}
const ok = rows.filter((r) => r.blink > 0.999);
ok.sort((a, b) => (b.range - a.range * 0) - 0 || 0);
// prefer: no blink, largest visible range with low turn speed
const score = (r) => r.range - 3 * (r.v0 + r.v1);
ok.sort((a, b) => score(b) - score(a));
console.log("no-blink windows:", ok.length, "of", rows.length);
console.log(ok.slice(0, 6).map((r) => JSON.stringify(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, +v.toFixed(3)])))).join("\n"));
const med = rows.map((r) => r.range).sort((a, b) => a - b)[Math.floor(rows.length / 2)];
console.log("median range over all windows", med.toFixed(2));
