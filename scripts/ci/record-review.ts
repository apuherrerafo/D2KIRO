// Crea el registro `docs/reviews/<sha8>-<proveedor>.review.json` a partir de la SALIDA CRUDA de un revisor y del diff real calculado con git. Uso:
//   bun run scripts/ci/record-review.ts --provider openai --tool "codex-cli 0.159.0" --model gpt-5 --raw <archivo-salida> --base <sha-base> \
//     --verdict "APROBADO CON OBSERVACIONES" [--findings <findings.json>] [--reviewed-head <sha>]
// La salida cruda se copia NORMALIZADA (UTF-8 sin BOM, saltos LF; si venía en UTF-16 de PowerShell se decodifica) y su hash se calcula sobre ese texto: el
// verificador normaliza igual, así `core.autocrlf` o un editor de Windows no producen un falso "fue editada". El hash del diff lo calcula este script con las MISMAS
// opciones de git que el verificador. Los `findings` los transcribe quien lo corre; la compuerta los contrasta con la salida cruda.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { codeDiffArgs, EVIDENCE_DIR, normalizeRaw, realGit, sha256 } from "./verify-review-evidence";

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

/** Decodifica la salida de un revisor: UTF-16 LE/BE con BOM (PowerShell) o UTF-8. */
export function decodeReviewerOutput(bytes: Buffer): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString("utf16le");
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return Buffer.from(bytes.subarray(2)).swap16().toString("utf16le");
  return bytes.toString("utf8");
}

if (import.meta.main) {
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
  const diff = git(codeDiffArgs(reviewedBase, reviewedHead));
  const findingsPath = arg("findings");
  const findings = findingsPath !== undefined ? (JSON.parse(readFileSync(findingsPath, "utf8")) as unknown[]) : [];
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const stem = `${reviewedHead.slice(0, 8)}-${provider.replace(/[^a-z0-9._-]/gi, "-")}`; // `human:alice` -> `human-alice` (el `:` es inválido en Windows y en las rutas permitidas)
  const rawTarget = `${EVIDENCE_DIR}${stem}.raw.txt`;
  const raw = normalizeRaw(decodeReviewerOutput(readFileSync(rawPath)));
  writeFileSync(rawTarget, raw);
  const record = {
    schema: "review-evidence/v1",
    reviewer: { provider, tool, model },
    reviewedBase,
    reviewedHead,
    diffSha256: sha256(diff),
    rawOutput: { file: rawTarget, sha256: sha256(raw) },
    findings,
    verdict,
  };
  const target = `${EVIDENCE_DIR}${stem}.review.json`;
  writeFileSync(target, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`escrito ${target} y ${rawTarget} (revisó ${reviewedHead.slice(0, 8)}, base ${reviewedBase.slice(0, 8)})`);
}
