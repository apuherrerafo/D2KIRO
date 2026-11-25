import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AGENT_ENTRIES, checkAgent, checkAgentEntries, checkAgentsMdRules, checkCastoffGate, parseAgent, checkRedteamEvidence, checkReviewerAlias, READ_ONLY_AGENT_HEADERS, checkCoordinationWorkflow, checkGeminiAdapter, checkModelsYaml, checkRootCauseRegression, checkJournalPolicy, checkPaths, checkSkillTools, parseFrontmatter,
} from "./contracts";

const YAML = ["tiers:", "  e:", "    modelo_actual: claude-sonnet-5", "    usado_en:", "      - .claude/agents/a.md"].join("\n");
const ROOT = join(import.meta.dir, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const exists = (p: string) => existsSync(join(ROOT, p));
const agentFiles = readdirSync(join(ROOT, ".claude/agents")).filter((f) => f.endsWith(".md"));

const fm = (name: string, tools: string, extra = "") =>
  `---\nname: ${name}\ndescription: x\nmodel: m\ntools: ${tools}\n---\n${extra}`;
const SIN_EVIDENCIA = "Sin evidencia: BLOCKED o NOT_VERIFIED.";

describe("contratos de skills — allowed-tools", () => {
  const sk = (tools: string, disallowed?: string) =>
    `---\nname: x\ndescription: d\nallowed-tools: "${tools}"\n${disallowed === undefined ? "" : `disallowed-tools: "${disallowed}"\n`}---\n`;
  const BLOQUEO = "Write Edit MultiEdit NotebookEdit Bash PowerShell Agent";
  test("el revisor (redteam) con Edit o Write se rechaza", () => {
    expect(checkSkillTools("redteam", sk("Read Grep Edit", BLOQUEO))).toHaveLength(1);
    expect(checkSkillTools("redteam", sk("Read Write", BLOQUEO))).toHaveLength(1);
  });
  test("redteam sólo lectura pasa (con disallowed-tools); un skill implementador (build) con Write pasa", () => {
    expect(checkSkillTools("redteam", sk("Read Grep", BLOQUEO))).toEqual([]);
    expect(checkSkillTools("build", sk("Read Write Edit Glob Grep"))).toEqual([]);
  });
  // allowed-tools sólo PRE-APRUEBA; lo que restringe de verdad es disallowed-tools (comprobado con el binario 2.1.329, TSK-260).
  test("redteam sin disallowed-tools se rechaza aunque allowed-tools diga Read Grep", () => {
    expect(checkSkillTools("redteam", sk("Read Grep"))).toHaveLength(1);
  });
  test("redteam: cada vía de escritura/ejecución que falte en disallowed-tools se rechaza, una por una", () => {
    for (const tool of BLOQUEO.split(" ")) {
      const sin = BLOQUEO.split(" ").filter((t) => t !== tool).join(" ");
      const errs = checkSkillTools("redteam", sk("Read Grep", sin));
      expect(errs).toHaveLength(1);
      expect(errs[0]).toContain(tool);
    }
  });
  test("mcp__context7 en cualquier skill se rechaza (context7.md)", () => {
    expect(checkSkillTools("build", sk("Read mcp__context7__get-library-docs"))[0]).toContain("context7");
  });
  test("tokens con paréntesis y espacios (Bash(bun test:*)) no confunden el parseo; sin allowed-tools no falla", () => {
    expect(checkSkillTools("root-cause", sk("Read Grep Edit Bash(bun test:*)"))).toEqual([]);
    expect(checkSkillTools("scout", "---\nname: scout\ndescription: d\n---\n")).toEqual([]);
  });
});

describe("contratos de agentes — casos negativos (deben fallar)", () => {
  const reviewer = (header: string) => `${header}${SIN_EVIDENCIA}`;
  test("revisor de sólo lectura: cada herramienta añadida a la cabecera se rechaza, en los tres", () => {
    const prohibidas = ["Bash", "PowerShell", "Write", "Edit", "MultiEdit", "NotebookEdit", "Agent", "Task", "Skill", "Monitor", "WebFetch", "WebSearch", "mcp__x", "*"];
    for (const [agent, header] of Object.entries(READ_ONLY_AGENT_HEADERS)) {
      for (const tool of prohibidas) {
        const errs = checkAgent(`${agent}.md`, reviewer(header.replace("Grep\n", `Grep, ${tool}\n`)));
        expect(errs.join(" ")).toContain("cabecera");
      }
    }
  });
  // Claude Code cierra el frontmatter en el primer `---`, aunque esté a mitad de línea: sin `tools` hereda TODO
  // (reproducido con el binario 2.1.329). Por eso la cabecera se compara entera y no se interpreta.
  test("revisor de sólo lectura: cualquier cambio de la cabecera se rechaza", () => {
    const header = READ_ONLY_AGENT_HEADERS.warden;
    const variantes = [
      header.replace("model: claude-sonnet-5", "model: claude-sonnet-5 ---"),
      header.replace("Se activa tras @build.", "Se activa --- tras @build."),
      header.replace("tools:", "memory: project\ntools:"),
      header.replace("tools:", "permissionMode: bypassPermissions\ntools:"),
      header.replace("tools:", "tools: Bash\ntools:"),
      header.replace("tools: Read, Glob, Grep\n", ""),
      `\uFEFF${header}`,
      `\n${header}`,
    ];
    for (const v of variantes) expect(checkAgent("warden.md", reviewer(v)).join(" ")).toContain("cabecera");
  });
  test("las cabeceras fijadas declaran exactamente Read, Glob, Grep y ningún `---` interior", () => {
    expect(Object.keys(READ_ONLY_AGENT_HEADERS).sort()).toEqual(["sentinel", "tracer", "warden"]);
    for (const header of Object.values(READ_ONLY_AGENT_HEADERS)) {
      expect(parseAgent(header).tools).toEqual(["Read", "Glob", "Grep"]);
      expect(header.split("---")).toHaveLength(3);
    }
  });
  test("subcarpeta, archivo extra (posible homónimo) o revisor ausente en .claude/agents se rechaza", () => {
    expect(checkAgentEntries([...AGENT_ENTRIES, "zz"])).toHaveLength(1);
    expect(checkAgentEntries([...AGENT_ENTRIES, "x.md"])).toHaveLength(1);
    expect(checkAgentEntries(AGENT_ENTRIES.filter((f) => f !== "warden.md"))).toHaveLength(1);
    expect(checkAgentEntries([...AGENT_ENTRIES].reverse())).toEqual([]);
  });
  test("revisor que no declara BLOCKED/NOT_VERIFIED se rechaza", () => {
    expect(checkAgent("warden.md", `${READ_ONLY_AGENT_HEADERS.warden}PASS o FAIL`)).toHaveLength(1);
  });
  test("castoff que sólo detiene ante FAIL se rechaza", () => {
    expect(checkCastoffGate('Si devuelve `"veredicto": "FAIL"`, DETENTE')).toHaveLength(1);
  });
  test("mcp__context7 en un agente no autorizado", () => {
    expect(checkAgent("chronicle.md", fm("chronicle", "Read, mcp__context7"))[0]).toContain("context7");
  });
  test("name distinto del archivo y sin tools", () => {
    expect(checkAgent("chronicle.md", "---\nname: otro\ndescription: x\nmodel: m\n---\n").length).toBe(2);
  });
  test("engineer de Fase 9 sin veto de escritura", () => {
    expect(checkAgent("data-stat-engineer.md", fm("data-stat-engineer", "Read, Write"))[0]).toContain("veto");
  });
  test("instruir vaciar journal.md", () => {
    const t = "- archívalo y empieza un `journal.md` nuevo y vacío.";
    expect(checkJournalPolicy("x.md", t)).toHaveLength(1);
  });
  test("adaptador de Gemini ausente, inválido o sin AGENTS.md", () => {
    expect(checkGeminiAdapter(null)).toHaveLength(1);
    expect(checkGeminiAdapter("{")).toHaveLength(1);
    expect(checkGeminiAdapter('{"context":{"fileName":"GEMINI.md"}}')).toHaveLength(1);
    expect(checkGeminiAdapter('{"context":{"fileName":["AGENTS.md","X.md"]}}')).toEqual([]);
  });
  test("models.yaml sin un agente, o con el tier equivocado", () => {
    const y = YAML;
    expect(checkModelsYaml([{ file: "b.md", model: "claude-sonnet-5" }], y)).toHaveLength(1);
    expect(checkModelsYaml([{ file: "a.md", model: "claude-haiku-4-5-20251001" }], y)).toHaveLength(1);
  });
  // Reproducido con el binario 2.1.329: `description: ... opcional: bloquea` sin comillas hace que Claude Code descarte el
  // agente EN SILENCIO; en su lugar entra el homónimo de ~/.claude/agents (aquí, un sentinel con Bash).
  test("cabecera que Claude Code no puede leer (': ' o ' #' sin comillas) se rechaza en cualquier agente", () => {
    for (const bad of ["No es opcional: bloquea.", "Gate # uno", "Termina en dos puntos:"]) {
      const text = fm("chronicle", "Read").replace("description: x", `description: ${bad}`);
      expect(checkAgent("chronicle.md", text).join(" ")).toContain("sin comillas");
    }
  });
  test("el mismo texto entre comillas, y dos puntos sin espacio, pasan", () => {
    for (const good of ['"No es opcional: bloquea."', "'Gate # uno'", "ruta a:b"]) {
      expect(checkAgent("chronicle.md", fm("chronicle", "Read").replace("description: x", `description: ${good}`))).toEqual([]);
    }
  });
  test("workflow de coordinación incompleto o root-cause sin regresión", () => {
    expect(checkCoordinationWorkflow("# /dispatch sólo enruta").length).toBeGreaterThan(5);
    expect(checkRootCauseRegression("Produce un comando que reproduzca el bug.")).toHaveLength(1);
  });
  test("instruir vaciar o borrar journal.md / ledger.md", () => {
    expect(checkJournalPolicy("x.md", "- Vacía journal.md cada mes.")).toHaveLength(1);
    expect(checkJournalPolicy("x.md", "- Borra el ledger.md viejo.")).toHaveLength(1);
  });
  test("ruta inexistente no declarada", () => {
    expect(checkPaths("x.md", "ver `docs/nada/inexistente.md`", () => false)).toHaveLength(1);
  });
  test("AGENTS.md afirma reglas con paths que no coinciden", () => {
    const md = "- Reglas por ruta (`paths:`): `engine.md`, `security.md`.";
    expect(checkAgentsMdRules(md, ["engine"]).length).toBe(1);
  });
});

describe("contratos de agentes — casos legítimos (deben pasar)", () => {
  test("revisor con la cabecera fijada pasa, también con CRLF", () => {
    const text = `${READ_ONLY_AGENT_HEADERS.sentinel}${SIN_EVIDENCIA}`;
    expect(checkAgent("sentinel.md", text)).toEqual([]);
    expect(checkAgent("sentinel.md", text.replaceAll("\n", "\r\n"))).toEqual([]);
  });
  test("artisan puede tener mcp__context7 y Write", () => {
    expect(checkAgent("artisan.md", fm("artisan", "Read, Write, mcp__context7"))).toEqual([]);
  });
  test("prohibir borrar journal.md no es una violación", () => {
    expect(checkJournalPolicy("x.md", "- Nunca comprimas o elimines `journal.md`.")).toEqual([]);
    expect(checkJournalPolicy("x.md", "- `journal.md` (append-only, NUNCA se reescribe ni se borra).")).toEqual([]);
  });
  test("crear un journal.md vacío en un repo nuevo es legítimo", () => {
    const t = "4. Crea `docs/agents/journal.md` vacío y escribe una primera entrada.";
    expect(checkJournalPolicy("x.md", t)).toEqual([]);
  });
  test("models.yaml coherente y root-cause con regresión pasan", () => {
    const y = YAML;
    expect(checkModelsYaml([{ file: "a.md", model: "claude-sonnet-5" }], y)).toEqual([]);
    expect(checkRootCauseRegression("la reproducción pasa a ser una prueba permanente: rojo antes, verde después")).toEqual([]);
  });
  test("salida generada declarada en la allowlist", () => {
    expect(checkPaths("x.md", "`docs/agents/BRAINSTORM.md`", () => false)).toEqual([]);
  });
  test("parseFrontmatter lee allowed-tools entre comillas", () => {
    expect(parseFrontmatter('---\nallowed-tools: "Read Grep"\n---')["allowed-tools"]).toBe("Read Grep");
  });
});

describe("contratos sobre el repo real", () => {
  test(".claude/agents contiene exactamente los agentes conocidos, sin subcarpetas", () => {
    expect(checkAgentEntries(readdirSync(join(ROOT, ".claude/agents")))).toEqual([]);
  });

  for (const f of agentFiles) {
    test(`agente ${f}`, () => {
      expect(checkAgent(f, read(`.claude/agents/${f}`))).toEqual([]);
    });
  }

  test("ningún agente/skill/comando manda borrar o vaciar un archivo append-only", () => {
    const files = [
      ...agentFiles.map((f) => `.claude/agents/${f}`),
      ...readdirSync(join(ROOT, ".claude/skills")).map((d) => `.claude/skills/${d}/SKILL.md`),
      ...readdirSync(join(ROOT, ".claude/commands")).map((f) => `.claude/commands/${f}`),
    ];
    expect(files.flatMap((f) => checkJournalPolicy(f, read(f)))).toEqual([]);
  });

  test("referencias de ruta de agentes, skills, comandos, reglas y AGENTS.md existen", () => {
    const files = [
      "AGENTS.md", "CLAUDE.md",
      ...agentFiles.map((f) => `.claude/agents/${f}`),
      ...readdirSync(join(ROOT, ".claude/skills")).map((d) => `.claude/skills/${d}/SKILL.md`),
      ...readdirSync(join(ROOT, ".claude/commands")).map((f) => `.claude/commands/${f}`),
      ...readdirSync(join(ROOT, ".claude/rules")).map((f) => `.claude/rules/${f}`),
    ];
    expect(files.flatMap((f) => checkPaths(f, read(f), exists))).toEqual([]);
  });

  test("models.yaml lista cada agente bajo el tier de su modelo", () => {
    const agents = agentFiles.map((f) => ({ file: f, model: parseFrontmatter(read(`.claude/agents/${f}`)).model }));
    expect(checkModelsYaml(agents, read("docs/agents/models.yaml"))).toEqual([]);
  });

  // Reproducido con el binario: con cwd=apps/web, un apps/web/.claude/agents/warden.md gana y trae Bash.
  test("no hay otro .claude/agents versionado fuera del de la raíz", () => {
    const r = Bun.spawnSync(["git", "ls-files", "--cached", "--others", "--exclude-standard", "--", "*.claude/agents/*"], { cwd: ROOT });
    expect(r.exitCode).toBe(0);
    const files = r.stdout.toString().split("\n").filter(Boolean);
    expect(files.length).toBeGreaterThanOrEqual(7);
    expect(files.filter((f) => !f.startsWith(".claude/agents/"))).toEqual([]);
  });

  // Observado con el binario: Sentinel dio PASS sin ninguna evidencia ("no hace falta") con la redacción condicional.
  test("los revisores con veredicto PASS lo condicionan siempre al paquete de evidencia", () => {
    for (const agent of ["warden", "sentinel"]) {
      expect(read(`.claude/agents/${agent}.md`)).toMatch(/Sin paquete de evidencia el veredicto es `BLOCKED`, aunque el código/);
    }
  });

  test("castoff sólo continúa con PASS de Sentinel", () => {
    expect(checkCastoffGate(read(".claude/skills/castoff/SKILL.md"))).toEqual([]);
  });

  test("dispatch declara el ciclo de coordinación y root-cause exige regresión permanente", () => {
    expect(checkCoordinationWorkflow(read(".claude/skills/dispatch/SKILL.md"))).toEqual([]);
    expect(checkRootCauseRegression(read(".claude/skills/root-cause/SKILL.md"))).toEqual([]);
  });

  // Reproducido con el binario 2.1.329 (TSK-262): /review mandaba LEER el SKILL.md, así que escribió con Write y Bash.
  test("un comando que remite a un skill revisor repite su disallowed-tools", () => {
    const errs = readdirSync(join(ROOT, ".claude/commands")).flatMap((f) => checkReviewerAlias(f, read(`.claude/commands/${f}`)));
    expect(errs).toEqual([]);
  });

  test("alias del revisor: sin bloqueo o incompleto se rechaza; el homónimo del skill y un comando ajeno pasan", () => {
    const body = "Sigue `.claude/skills/redteam/SKILL.md`.";
    const header = (d: string) => `---
description: x
disallowed-tools: "${d}"
---
${body}`;
    expect(checkReviewerAlias("review.md", body)).toHaveLength(1);
    expect(checkReviewerAlias("review.md", header("Write Edit MultiEdit NotebookEdit PowerShell Agent"))).toHaveLength(1);
    expect(checkReviewerAlias("review.md", header("Write Edit MultiEdit NotebookEdit Bash PowerShell Agent"))).toEqual([]);
    expect(checkReviewerAlias("redteam.md", body)).toEqual([]);
    expect(checkReviewerAlias("fix.md", "Sigue `.claude/skills/root-cause/SKILL.md`.")).toEqual([]);
  });

  // Contrato de TEXTO (TSK-263): comprueba lo que el skill pide, no que un modelo lo cumpla.
  test("redteam pide BLOCKED sin evidencia del diff y declara que esa regla no es un control ejecutable", () => {
    expect(checkRedteamEvidence(read(".claude/skills/redteam/SKILL.md"))).toEqual([]);
  });

  test("allowed-tools de cada skill (declaración, no control ejecutable): el revisor no declara escritura y ninguno declara context7", () => {
    const errs = readdirSync(join(ROOT, ".claude/skills")).flatMap((d) => checkSkillTools(d, read(`.claude/skills/${d}/SKILL.md`)));
    expect(errs).toEqual([]);
  });

  test("el adaptador de Gemini apunta a AGENTS.md", () => {
    const p = join(ROOT, ".gemini/settings.json");
    expect(checkGeminiAdapter(existsSync(p) ? readFileSync(p, "utf8") : null)).toEqual([]);
  });

  test("AGENTS.md lista exactamente las reglas con paths:", () => {
    const withPaths = readdirSync(join(ROOT, ".claude/rules"))
      .filter((f) => /^paths:/m.test(read(`.claude/rules/${f}`).split(/\r?\n---/)[0]))
      .map((f) => f.replace(/\.md$/, ""));
    expect(checkAgentsMdRules(read("AGENTS.md"), withPaths)).toEqual([]);
  });
});
