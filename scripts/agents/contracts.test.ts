import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkAgent, checkAgentsMdRules, checkGeminiAdapter, checkJournalPolicy, checkPaths, parseFrontmatter,
} from "./contracts";

const ROOT = join(import.meta.dir, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const exists = (p: string) => existsSync(join(ROOT, p));
const agentFiles = readdirSync(join(ROOT, ".claude/agents")).filter((f) => f.endsWith(".md"));

const fm = (name: string, tools: string, extra = "") =>
  `---\nname: ${name}\ndescription: x\nmodel: m\ntools: ${tools}\n---\n${extra}`;

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
