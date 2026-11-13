// Crea el registro `docs/reviews/<sha8>-<proveedor>-<n>.review.json` a partir de la SALIDA CRUDA de un revisor (copiada tal cual, con su SHA-256) y del
// diff real calculado con git. Uso:
//   bun run scripts/ci/record-review.ts --provider openai --tool "codex-cli 0.159.0" --model gpt-5 --raw <archivo-salida> --base <sha-base> \
//     --verdict "APROBADO CON OBSERVACIONES" [--findings <findings.json>] [--reviewed-head <sha>]
// No inventa nada: el hash del diff y el de la salida los calcula este script; los `findings` los transcribe quien lo corre (y la compuerta los vigila).
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { EVIDENCE_DIR, realGit } from "./verify-review-evidence";

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

const git = realGit();
const provider = arg("provider");
const tool = arg("tool");
const model = arg("model");
const rawPath = arg("raw");
const baseRef = arg("base");
const verdict = arg("verdict") ?? "APROBADO";
if (provider === undefined || tool === undefined || model === undefined || rawPath === undefined || baseRef === undefined || !existsSync(rawPath)) {
  console.error("Uso: bun run scripts/ci/record-review.ts --provider <p> --tool <t> --model <m> --raw <archivo> --base <sha> [--verdict V] [--findings f.json] [--reviewed-head sha]");
  process.exit(2);
}
const reviewedHead = (arg("reviewed-head") ?? git(["rev-parse", "HEAD"])).trim();
const reviewedBase = git(["merge-base", baseRef, reviewedHead]).trim();
const diff = git(["diff", "--no-color", "--binary", reviewedBase, reviewedHead, "--", ".", `:(exclude)${EVIDENCE_DIR}`]);
const findingsPath = arg("findings");
const findings = findingsPath !== undefined ? (JSON.parse(readFileSync(findingsPath, "utf8")) as unknown[]) : [];
mkdirSync(EVIDENCE_DIR, { recursive: true });
const stem = `${reviewedHead.slice(0, 8)}-${provider}`;
const rawTarget = `${EVIDENCE_DIR}${stem}.raw.txt`;
copyFileSync(rawPath, rawTarget);
const record = {
  schema: "review-evidence/v1",
  reviewer: { provider, tool, model },
  reviewedBase,
  reviewedHead,
  diffSha256: createHash("sha256").update(diff).digest("hex"),
  rawOutput: { file: rawTarget, sha256: createHash("sha256").update(readFileSync(rawTarget)).digest("hex") },
  findings,
  verdict,
};
const target = `${EVIDENCE_DIR}${stem}.review.json`;
writeFileSync(target, `${JSON.stringify(record, null, 2)}\n`);
console.log(`escrito ${target} y ${basename(rawTarget)} (revisó ${reviewedHead.slice(0, 8)}, base ${reviewedBase.slice(0, 8)})`);
