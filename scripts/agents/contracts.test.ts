import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkAgent, checkAgentsMdRules, checkCoordinationWorkflow, checkGeminiAdapter, checkModelsYaml, checkRootCauseRegression, checkJournalPolicy, checkPaths, checkSkillTools, parseFrontmatter,
} from "./contracts";

const YAML = ["tiers:", "  e:", "    modelo_actual: claude-sonnet-5", "    usado_en:", "      - .claude/agents/a.md"].join("\n");
const ROOT = join(import.meta.dir, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const exists = (p: string) => existsSync(join(ROOT, p));
const agentFiles = readdirSync(join(ROOT, ".claude/agents")).filter((f) => f.endsWith(".md"));

const fm = (name: string, tools: string, extra = "") =>
  `---\nname: ${name}\ndescription: x\nmodel: m\ntools: ${tools}\n---\n${extra}`;

describe("contratos de skills — allowed-tools", () => {
  const sk = (tools: string) => `---\nname: x\ndescription: d\nallowed-tools: "${tools}"\n---\n`;
  test("el revisor (redteam) con Edit o Write se rechaza", () => {
    expect(checkSkillTools("redteam", sk("Read Grep Edit"))).toHaveLength(1);
    expect(checkSkillTools("redteam", sk("Read Write"))).toHaveLength(1);
  });
  test("redteam sólo lectura pasa; un skill implementador (build) con Write pasa", () => {
    expect(checkSkillTools("redteam", sk("Read Grep"))).toEqual([]);
    expect(checkSkillTools("build", sk("Read Write Edit Glob Grep"))).toEqual([]);
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
  test("agente de sólo lectura con Write", () => {
    expect(checkAgent("tracer.md", fm("tracer", "Read, Write"))).toHaveLength(1);
  });
  test("mcp__context7 en un agente no autorizado", () => {
    expect(checkAgent("tracer.md", fm("tracer", "Read, mcp__context7"))[0]).toContain("context7");
  });
  test("name distinto del archivo y sin tools", () => {
    expect(checkAgent("warden.md", "---\nname: otro\ndescription: x\nmodel: m\n---\n").length).toBe(2);
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

  test("dispatch declara el ciclo de coordinación y root-cause exige regresión permanente", () => {
    expect(checkCoordinationWorkflow(read(".claude/skills/dispatch/SKILL.md"))).toEqual([]);
    expect(checkRootCauseRegression(read(".claude/skills/root-cause/SKILL.md"))).toEqual([]);
  });

  test("allowed-tools de cada skill: el revisor no escribe y ninguno usa context7", () => {
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
