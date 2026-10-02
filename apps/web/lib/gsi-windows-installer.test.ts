import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildGsiConfig, GSI_CFG_FILENAME } from "./gsi-config";
import { buildWindowsGsiInstaller, buildWindowsGsiUninstaller, GSI_WINDOWS_INSTALLER_FILENAME, GSI_WINDOWS_UNINSTALLER_FILENAME } from "./gsi-windows-installer";

// The zero-terminal Windows installer. Pure checks lock the file's shape and where the credential may
// appear; on Windows the generated file is also RUN (cmd.exe + Windows PowerShell 5.1) against a fake
// Steam layout under the temp folder -- never the machine's real Steam, never the network.

const ORIGIN = "https://d2kiro-test.up.railway.app";
const TOKEN = "ab".repeat(32);
const CFG = buildGsiConfig(`${ORIGIN}/api/live/gsi/${"L".repeat(43)}`, TOKEN);

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

/** Everything cmd.exe parses: the lines up to the one that ends the batch. */
function batchPart(file: string, terminator: string): string {
  const end = file.indexOf(terminator);
  expect(end).toBeGreaterThan(0);
  return file.slice(0, end + terminator.length);
}

describe("Windows GSI installer (generated file)", () => {
  const installer = buildWindowsGsiInstaller(CFG);
  const uninstaller = buildWindowsGsiUninstaller();

  test("CRLF everywhere (cmd.exe mis-parses bare LF)", () => {
    for (const file of [installer, uninstaller]) {
      expect(file).toContain("\r\n");
      expect(file.replace(/\r\n/g, "")).not.toContain("\n");
      expect(file.startsWith("@echo off\r\n")).toBe(true);
    }
  });

  test("the token appears exactly once, inside the trailing data block -- never in the command line or the script", () => {
    expect(occurrences(installer, TOKEN)).toBe(1);
    const payloadStart = installer.indexOf("#D2KIRO-CFG-BEGIN");
    const scriptEnd = installer.indexOf("#D2KIRO-SCRIPT-END");
    expect(scriptEnd).toBeGreaterThan(0);
    expect(payloadStart).toBeGreaterThan(scriptEnd);
    expect(installer.indexOf(TOKEN)).toBeGreaterThan(payloadStart);
    expect(installer.slice(0, payloadStart)).not.toContain(TOKEN);
    expect(installer.slice(0, payloadStart)).not.toContain("d2kiro-test.up.railway.app");
    expect(installer.slice(0, payloadStart)).not.toContain("L".repeat(43));
  });

  test("the batch part is ASCII, calls PowerShell by absolute path, and the installer deletes itself", () => {
    const batch = batchPart(installer, '(goto) 2>nul & del "%~f0" & exit /b %D2KIRO_EXIT%');
    expect(batch).not.toMatch(/[^\x09\x0A\x0D\x20-\x7E]/);
    expect(batch).toContain('"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoLogo -NoProfile');
    expect(batch).not.toMatch(/(^|[\s&])powershell(\.exe)?\s/im);
    expect(batch).toContain('set "D2KIRO_MODE=install"');
    // The bootstrap never contains the joined markers it searches for (it would find itself).
    expect(occurrences(installer, "#D2KIRO-SCRIPT-BEGIN")).toBe(1);
    expect(occurrences(installer, "#D2KIRO-CFG-BEGIN")).toBe(1);
  });

  test("the uninstaller carries no credential, no payload, and does not delete itself", () => {
    expect(uninstaller).not.toContain(TOKEN);
    expect(uninstaller).not.toContain("#D2KIRO-CFG-BEGIN");
    expect(uninstaller).not.toContain("d2kiro-test.up.railway.app");
    const batch = batchPart(uninstaller, "exit /b %ERRORLEVEL%");
    expect(batch).toContain('set "D2KIRO_MODE=uninstall"');
    expect(batch).not.toContain("del ");
    expect(batch).not.toMatch(/[^\x09\x0A\x0D\x20-\x7E]/);
  });

  test("the script stays inside its lane: one file name, no network, no account data", () => {
    const script = installer.slice(installer.indexOf("#D2KIRO-SCRIPT-BEGIN"), installer.indexOf("#D2KIRO-SCRIPT-END"));
    expect(script).toContain(`$CfgName = '${GSI_CFG_FILENAME}'`);
    expect(script).not.toMatch(/Invoke-WebRequest|Invoke-RestMethod|Net\.WebClient|HttpClient|Net\.Sockets|Start-BitsTransfer|curl|wget/i);
    expect(script).not.toMatch(/userdata|loginusers|config\.vdf|ActiveUser|AutoLoginUser|LastOwner/i);
    // The app manifest is only checked for existence, never read.
    expect(script).not.toMatch(/Read\w*\([^)]*appmanifest/i);
    // Nothing that prints or logs the cfg text.
    expect(script).not.toMatch(/Write-\w+\s+\$cfgText|Out-File|Start-Transcript|Add-Content/i);
    expect(script).not.toMatch(/Remove-Item|RemoveDirectory|Directory\]::Delete/);
  });

  test("refuses to embed anything that is not a D2KIRO cfg", () => {
    expect(() => buildWindowsGsiInstaller("")).toThrow();
    expect(() => buildWindowsGsiInstaller('"Other"\r\n{\r\n}')).toThrow();
    expect(() => buildWindowsGsiInstaller(`${CFG}#D2KIRO-CFG-END\r\n@echo pwned`)).toThrow();
    expect(() => buildWindowsGsiInstaller(CFG.replace("D2KIRO\"\n", "D2KIRO\" ñ\n"))).toThrow();
  });

  test("file names are the ones the page promises", () => {
    expect(GSI_WINDOWS_INSTALLER_FILENAME).toBe("instalar-d2kiro-dota.cmd");
    expect(GSI_WINDOWS_UNINSTALLER_FILENAME).toBe("quitar-d2kiro-dota.cmd");
  });
});

// ---- Real run on Windows -------------------------------------------------------------------------------

const onWindows = process.platform === "win32";
const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

interface FakeMachine {
  root: string;
  downloads: string;
  steam: string;
  /** `<library>\steamapps\common\dota 2 beta\game\dota\cfg`, by library name. */
  dotaCfg(library: string): string;
}

/** A Steam root whose libraryfolders.vdf lists the given extra libraries; Dota in the ones asked for. */
function fakeMachine(options: { libraries: string[]; dotaIn: string[]; manifestIn?: string[]; downloadsName?: string; steamName?: string; extraVdfPaths?: (root: string) => string[] }): FakeMachine {
  // An accented, spaced folder: the installer must cope with real Windows user paths.
  const root = mkdtempSync(join(tmpdir(), "d2kiro-gsi-"));
  roots.push(root);
  const downloads = join(root, options.downloadsName ?? "Descargas de José");
  const steam = join(root, options.steamName ?? "Steam");
  mkdirSync(downloads, { recursive: true });
  mkdirSync(join(steam, "steamapps"), { recursive: true });
  const libraryPath = (library: string) => (library === "Steam" ? steam : join(root, library));
  const dotaCfg = (library: string) => join(libraryPath(library), "steamapps", "common", "dota 2 beta", "game", "dota", "cfg");
  const vdfEscape = (path: string) => path.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const vdfPaths = [steam, ...options.libraries.map(libraryPath), ...(options.extraVdfPaths?.(root) ?? [])];
  const entries = vdfPaths.map((path, index) => `\t"${index}"\r\n\t{\r\n\t\t"path"\t\t"${vdfEscape(path)}"\r\n\t\t"apps"\r\n\t\t{\r\n\t\t\t"570"\t\t"123456"\r\n\t\t}\r\n\t}`);
  writeFileSync(join(steam, "steamapps", "libraryfolders.vdf"), `"libraryfolders"\r\n{\r\n${entries.join("\r\n")}\r\n}\r\n`);
  for (const library of options.dotaIn) mkdirSync(dotaCfg(library), { recursive: true });
  for (const library of options.manifestIn ?? options.dotaIn) writeFileSync(join(libraryPath(library), "steamapps", "appmanifest_570.acf"), "\"AppState\"\r\n{\r\n}\r\n");
  return { root, downloads, steam, dotaCfg };
}

function run(machine: FakeMachine, fileName: string, contents: string, extraEnv?: Record<string, string>): { exitCode: number; output: string } {
  const path = join(machine.downloads, fileName);
  writeFileSync(path, contents);
  // Like Explorer's double-click: absolute path, wrapped as cmd /s /c ""<path>"" (verbatim, so a folder
  // name with & ( ) ^ is not re-parsed by the test harness; `call` would mangle carets).
  const result = spawnSync("cmd.exe", ["/d", "/s", "/c", `""${path}""`], {
    cwd: machine.downloads,
    env: { ...process.env, D2KIRO_TEST_STEAM_ROOT: machine.steam, D2KIRO_TEST_NO_DIALOG: "1", ...extraEnv },
    windowsVerbatimArguments: true,
    encoding: "utf8",
  });
  return { exitCode: result.status ?? -1, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

function installedCfg(machine: FakeMachine, library: string): string {
  return join(machine.dotaCfg(library), "gamestate_integration", GSI_CFG_FILENAME);
}

describe.skipIf(!onWindows)("Windows GSI installer (real cmd.exe + PowerShell run)", () => {
  test("Dota on another library (D:-style): creates gamestate_integration, installs the exact cfg, deletes itself, never prints the token", () => {
    const machine = fakeMachine({ libraries: ["SteamLibrary"], dotaIn: ["SteamLibrary"] });
    const { exitCode, output } = run(machine, GSI_WINDOWS_INSTALLER_FILENAME, buildWindowsGsiInstaller(CFG));
    expect(exitCode).toBe(0);
    expect(readFileSync(installedCfg(machine, "SteamLibrary"), "utf8").replace(/\r\n/g, "\n")).toBe(CFG);
    expect(existsSync(join(machine.downloads, GSI_WINDOWS_INSTALLER_FILENAME))).toBe(false);
    expect(output).not.toContain(TOKEN);
    expect(output).toContain("D2KIRO qued"); // piped console output is not UTF-8: match ASCII only
    // Only our file in the integrations folder; nothing else written next to the installer.
    expect(readdirSync(join(machine.dotaCfg("SteamLibrary"), "gamestate_integration"))).toEqual([GSI_CFG_FILENAME]);
    expect(readdirSync(machine.downloads)).toEqual([]);
  }, 30_000);

  test("Dota in the Steam folder itself (C:-style), other integrations untouched, re-install overwrites only ours", () => {
    const machine = fakeMachine({ libraries: [], dotaIn: ["Steam"] });
    const integrations = join(machine.dotaCfg("Steam"), "gamestate_integration");
    mkdirSync(integrations, { recursive: true });
    writeFileSync(join(integrations, "gamestate_integration_other.cfg"), "other tool");
    writeFileSync(join(integrations, GSI_CFG_FILENAME), "stale D2KIRO cfg");
    expect(run(machine, GSI_WINDOWS_INSTALLER_FILENAME, buildWindowsGsiInstaller(CFG)).exitCode).toBe(0);
    expect(readFileSync(join(integrations, GSI_CFG_FILENAME), "utf8").replace(/\r\n/g, "\n")).toBe(CFG);
    expect(readFileSync(join(integrations, "gamestate_integration_other.cfg"), "utf8")).toBe("other tool");
  }, 30_000);

  test("a leftover Dota copy without Steam's manifest is skipped when the registered one exists", () => {
    const machine = fakeMachine({ libraries: ["OldLibrary", "SteamLibrary"], dotaIn: ["OldLibrary", "SteamLibrary"], manifestIn: ["SteamLibrary"] });
    expect(run(machine, GSI_WINDOWS_INSTALLER_FILENAME, buildWindowsGsiInstaller(CFG)).exitCode).toBe(0);
    expect(existsSync(installedCfg(machine, "SteamLibrary"))).toBe(true);
    expect(existsSync(installedCfg(machine, "OldLibrary"))).toBe(false);
  }, 30_000);

  test("stale Dota copy in Steam libraries does not terminate discovery: continues to active Dota in fallback library", () => {
    // Steam library has a stale Dota copy (files exist, but appmanifest_570.acf is missing)
    const machine = fakeMachine({ libraries: ["StaleLibrary"], dotaIn: ["StaleLibrary"], manifestIn: [] });
    // Fallback library has the real active Dota copy (files exist AND appmanifest_570.acf exists)
    const fallbackDir = join(machine.root, "FallbackActiveLibrary");
    const fallbackDotaCfg = join(fallbackDir, "steamapps", "common", "dota 2 beta", "game", "dota", "cfg");
    mkdirSync(fallbackDotaCfg, { recursive: true });
    writeFileSync(join(fallbackDir, "steamapps", "appmanifest_570.acf"), '"AppState"\r\n{\r\n}\r\n');

    const { exitCode } = run(machine, GSI_WINDOWS_INSTALLER_FILENAME, buildWindowsGsiInstaller(CFG), {
      D2KIRO_TEST_FALLBACK_LIBRARIES: fallbackDir,
    });

    expect(exitCode).toBe(0);
    // Stale copy must NOT be configured
    expect(existsSync(installedCfg(machine, "StaleLibrary"))).toBe(false);
    // Valid active installation in fallback library MUST be configured
    expect(existsSync(join(fallbackDotaCfg, "gamestate_integration", GSI_CFG_FILENAME))).toBe(true);
    expect(readFileSync(join(fallbackDotaCfg, "gamestate_integration", GSI_CFG_FILENAME), "utf8").replace(/\r\n/g, "\n")).toBe(CFG);
  }, 30_000);

  test("only a stale Dota copy exists with no active installation anywhere: fails closed, not treated as successful discovery", () => {
    // Steam library has only a stale copy (no manifest anywhere)
    const machine = fakeMachine({ libraries: ["StaleLibrary"], dotaIn: ["StaleLibrary"], manifestIn: [] });

    const { exitCode, output } = run(machine, GSI_WINDOWS_INSTALLER_FILENAME, buildWindowsGsiInstaller(CFG));

    expect(exitCode).toBe(2);
    expect(output).toContain("No encontramos Dota 2");
    expect(existsSync(installedCfg(machine, "StaleLibrary"))).toBe(false);
  }, 30_000);

  test("a truncated installer executed by cmd.exe fails closed: non-zero exit, no cfg written, sibling files untouched", () => {
    const machine = fakeMachine({ libraries: ["SteamLibrary"], dotaIn: ["SteamLibrary"] });
    const siblingPath = join(machine.downloads, "important-document.txt");
    writeFileSync(siblingPath, "untouched user data");
    const dotaAutoexec = join(machine.dotaCfg("SteamLibrary"), "autoexec.cfg");
    writeFileSync(dotaAutoexec, "keep");

    const genuine = buildWindowsGsiInstaller(CFG);

    // Truncate at different stages:
    // 1. In batch header
    // 2. Mid-script (before #D2KIRO-SCRIPT-END)
    // 3. Between script end and cfg begin
    // 4. Mid-cfg (before #D2KIRO-CFG-END)
    const truncations = [
      genuine.slice(0, genuine.indexOf("function Show-Result")),
      genuine.slice(0, genuine.indexOf("#D2KIRO-SCRIPT-END") - 40),
      genuine.slice(0, genuine.indexOf("#D2KIRO-CFG-BEGIN") + 5),
      genuine.slice(0, genuine.indexOf("#D2KIRO-CFG-END") - 20),
      genuine.slice(0, genuine.indexOf("#D2KIRO-CFG-END")),
    ];

    for (const truncated of truncations) {
      const { exitCode } = run(machine, GSI_WINDOWS_INSTALLER_FILENAME, truncated);
      expect(exitCode).not.toBe(0);
      expect(existsSync(installedCfg(machine, "SteamLibrary"))).toBe(false);
      expect(readFileSync(siblingPath, "utf8")).toBe("untouched user data");
      expect(readFileSync(dotaAutoexec, "utf8")).toBe("keep");
    }
  }, 60_000);

  test("Dota not found: clear message, exit 2, nothing written anywhere, the installer still removes itself", () => {
    const machine = fakeMachine({ libraries: ["SteamLibrary"], dotaIn: [] });
    const { exitCode, output } = run(machine, GSI_WINDOWS_INSTALLER_FILENAME, buildWindowsGsiInstaller(CFG));
    expect(exitCode).toBe(2);
    expect(output).toContain("No encontramos Dota 2");
    expect(output).not.toContain(TOKEN);
    expect(existsSync(join(machine.root, "SteamLibrary", "steamapps", "common"))).toBe(false);
    expect(readdirSync(machine.downloads)).toEqual([]);
  }, 30_000);

  test("a tampered payload is refused: exit 4, nothing written", () => {
    const machine = fakeMachine({ libraries: [], dotaIn: ["Steam"] });
    const tampered = buildWindowsGsiInstaller(CFG).replace(`${ORIGIN}/api/live/gsi/`, "https://evil.example/api/live/gsi/");
    const evilFirst = tampered.replace('"uri"', '"uri"           "https://evil.example/x"\r\n    "uri"');
    for (const file of [evilFirst, buildWindowsGsiInstaller(CFG).replace(TOKEN, "zz".repeat(32))]) {
      const { exitCode, output } = run(machine, GSI_WINDOWS_INSTALLER_FILENAME, file);
      expect(exitCode).toBe(4);
      expect(output).toContain("incompleto o fue modificado");
      expect(existsSync(join(machine.dotaCfg("Steam"), "gamestate_integration"))).toBe(false);
    }
  }, 60_000);

  test("the uninstaller removes only gamestate_integration_d2kiro.cfg, from every Dota copy found", () => {
    const machine = fakeMachine({ libraries: ["SteamLibrary", "OldLibrary"], dotaIn: ["SteamLibrary", "OldLibrary"], manifestIn: ["SteamLibrary"] });
    for (const library of ["SteamLibrary", "OldLibrary"]) {
      const integrations = join(machine.dotaCfg(library), "gamestate_integration");
      mkdirSync(integrations, { recursive: true });
      writeFileSync(join(integrations, GSI_CFG_FILENAME), CFG);
      writeFileSync(join(integrations, "gamestate_integration_other.cfg"), "other tool");
    }
    const first = run(machine, GSI_WINDOWS_UNINSTALLER_FILENAME, buildWindowsGsiUninstaller());
    expect(first.exitCode).toBe(0);
    expect(first.output).toContain("Listo: se quit");
    for (const library of ["SteamLibrary", "OldLibrary"]) {
      expect(existsSync(installedCfg(machine, library))).toBe(false);
      expect(readFileSync(join(machine.dotaCfg(library), "gamestate_integration", "gamestate_integration_other.cfg"), "utf8")).toBe("other tool");
    }
    // Idempotent, and the uninstaller (no credential inside) stays for reuse.
    const second = run(machine, GSI_WINDOWS_UNINSTALLER_FILENAME, buildWindowsGsiUninstaller());
    expect(second.exitCode).toBe(0);
    expect(second.output).toContain("ninguna configuraci");
    expect(existsSync(join(machine.downloads, GSI_WINDOWS_UNINSTALLER_FILENAME))).toBe(true);
  }, 60_000);
});

describe("Windows GSI installer (payload shape, any platform)", () => {
  // The script validates the payload with ONE anchored regex derived from buildGsiConfig. PowerShell is not
  // available off Windows, so the same pattern is lifted out of the generated script and checked here.
  const installer = buildWindowsGsiInstaller(CFG);
  const pattern = /-cnotmatch '(\^"D2KIRO".*\$)'/.exec(installer)?.[1];
  const normalize = (cfg: string) => cfg.replace(/\s+/g, " ").trim();

  test("accepts exactly what the site generates", () => {
    expect(pattern).toBeDefined();
    expect(new RegExp(pattern!).test(normalize(CFG))).toBe(true);
    expect(new RegExp(pattern!).test(normalize(CFG.replace(ORIGIN, "http://localhost:3000")))).toBe(false);
  });

  test("refuses an extra key, a second endpoint, a changed value, a bad id or a bad token", () => {
    const shape = new RegExp(pattern!);
    expect(shape.test(normalize(CFG.replace('"timeout"', '"extra" "1"\n    "timeout"')))).toBe(false);
    expect(shape.test(normalize(CFG.replace('"uri"', '"uri" "https://evil.example/x"\n    "uri"')))).toBe(false);
    expect(shape.test(normalize(CFG.replace('"heartbeat"     "5.0"', '"heartbeat"     "0.0"')))).toBe(false);
    expect(shape.test(normalize(CFG.replace("L".repeat(43), "L".repeat(42))))).toBe(false);
    expect(shape.test(normalize(CFG.replace(TOKEN, "ab".repeat(31))))).toBe(false);
    expect(shape.test(normalize(`${CFG}"EVIL" { }`))).toBe(false);
  });
});

describe.skipIf(!onWindows)("Windows GSI installer (hostile paths and inputs, real run)", () => {
  // NTFS allows these in folder names; they are the characters cmd.exe treats as syntax. Neither the
  // downloads folder, the Steam root nor the library may ever be parsed by cmd or PowerShell as code.
  const HOSTILE = "Juegos & Co (x86) [1] 100% !hot 'q' ^ ; , ñé $x @y";

  test("installer: hostile characters in the downloads folder, Steam root and library -> installs, deletes only itself", () => {
    const machine = fakeMachine({ libraries: [HOSTILE], dotaIn: [HOSTILE], downloadsName: `Descargas ${HOSTILE}`, steamName: `Steam ${HOSTILE}` });
    const { exitCode, output } = run(machine, GSI_WINDOWS_INSTALLER_FILENAME, buildWindowsGsiInstaller(CFG));
    expect(exitCode).toBe(0);
    expect(readFileSync(installedCfg(machine, HOSTILE), "utf8").replace(/\r\n/g, "\n")).toBe(CFG);
    expect(readdirSync(join(machine.dotaCfg(HOSTILE), "gamestate_integration"))).toEqual([GSI_CFG_FILENAME]);
    expect(readdirSync(machine.downloads)).toEqual([]);
    expect(output).not.toContain(TOKEN);
  }, 30_000);

  test("uninstaller: hostile characters everywhere -> removes only the D2KIRO cfg", () => {
    const machine = fakeMachine({ libraries: [HOSTILE], dotaIn: [HOSTILE], downloadsName: `Descargas ${HOSTILE}`, steamName: `Steam ${HOSTILE}` });
    const integrations = join(machine.dotaCfg(HOSTILE), "gamestate_integration");
    mkdirSync(integrations, { recursive: true });
    writeFileSync(join(integrations, GSI_CFG_FILENAME), CFG);
    expect(run(machine, GSI_WINDOWS_UNINSTALLER_FILENAME, buildWindowsGsiUninstaller()).exitCode).toBe(0);
    expect(readdirSync(integrations)).toEqual([]);
  }, 30_000);

  test("self-delete removes only the installer itself, never a sibling download, even one named alike", () => {
    const machine = fakeMachine({ libraries: [], dotaIn: ["Steam"] });
    const siblings = ["instalar-d2kiro-dota (1).cmd", "instalar-d2kiro-dota.cmd.bak", "notas.txt", "otro-instalador.cmd"];
    for (const name of siblings) writeFileSync(join(machine.downloads, name), "keep me");
    mkdirSync(join(machine.downloads, "subcarpeta"));
    expect(run(machine, GSI_WINDOWS_INSTALLER_FILENAME, buildWindowsGsiInstaller(CFG)).exitCode).toBe(0);
    expect(readdirSync(machine.downloads).sort()).toEqual([...siblings, "subcarpeta"].sort());
    for (const name of siblings) expect(readFileSync(join(machine.downloads, name), "utf8")).toBe("keep me");
  }, 30_000);

  test("a download renamed by the browser, '(1)' in a hostile folder, still deletes only itself", () => {
    const machine = fakeMachine({ libraries: [], dotaIn: ["Steam"], downloadsName: `Descargas ${HOSTILE}` });
    writeFileSync(join(machine.downloads, GSI_WINDOWS_INSTALLER_FILENAME), "the first download, keep");
    expect(run(machine, "instalar-d2kiro-dota (1).cmd", buildWindowsGsiInstaller(CFG)).exitCode).toBe(0);
    expect(readdirSync(machine.downloads)).toEqual([GSI_WINDOWS_INSTALLER_FILENAME]);
  }, 30_000);

  test("libraryfolders.vdf with shell syntax, traversal and junk is only ever data: nothing runs, nothing is written outside Dota", () => {
    const marker = (root: string) => join(root, "PWNED.txt");
    const machine = fakeMachine({
      libraries: ["SteamLibrary"],
      dotaIn: ["SteamLibrary"],
      extraVdfPaths: (root) => [
        `C:\\x" & echo pwned> "${marker(root)}" & "`,
        `C:\\a | echo pwned> "${marker(root)}"`,
        "C:\\%COMSPEC%\\!PATH!\\$(calc)",
        "C:\\..\\..\\..\\Windows\\System32",
        "D:relative",
        "relative\\only",
        "C:",
        "C:\\".padEnd(400, "a"),
      ],
    });
    const { exitCode } = run(machine, GSI_WINDOWS_INSTALLER_FILENAME, buildWindowsGsiInstaller(CFG));
    expect(exitCode).toBe(0);
    expect(existsSync(installedCfg(machine, "SteamLibrary"))).toBe(true);
    expect(existsSync(marker(machine.root))).toBe(false);
    expect(existsSync(join(machine.downloads, "PWNED.txt"))).toBe(false);
    expect(existsSync("C:\\Windows\\System32\\gamestate_integration")).toBe(false);
  }, 30_000);

  test("a library only reachable through a UNC (network) path is never used: not found, nothing written", () => {
    const machine = fakeMachine({
      libraries: [],
      dotaIn: ["SteamLibrary"],
      // The same local folder, spelled as \\localhost\C$\... -- the loopback admin share.
      extraVdfPaths: (root) => [join(root, "SteamLibrary").replace(/^([A-Za-z]):/, "\\\\localhost\\$1$$")],
    });
    const { exitCode, output } = run(machine, GSI_WINDOWS_INSTALLER_FILENAME, buildWindowsGsiInstaller(CFG));
    expect(exitCode).toBe(2);
    expect(output).toContain("No encontramos Dota 2");
    expect(existsSync(join(machine.dotaCfg("SteamLibrary"), "gamestate_integration"))).toBe(false);
  }, 30_000);

  test("a tampered payload with an extra key, a second endpoint or an edited value is refused: exit 4, nothing written", () => {
    const machine = fakeMachine({ libraries: [], dotaIn: ["Steam"] });
    const genuine = buildWindowsGsiInstaller(CFG);
    const tampered = [
      genuine.replace('"timeout"', '"evil"          "1"\r\n    "timeout"'),
      genuine.replace('"heartbeat"     "5.0"', '"heartbeat"     "0.0"'),
      genuine.replace("#D2KIRO-CFG-END", '"uri" "https://evil.example/x"\r\n#D2KIRO-CFG-END'),
      genuine.slice(0, genuine.indexOf('"auth"')),
    ];
    for (const file of tampered) {
      const { exitCode } = run(machine, GSI_WINDOWS_INSTALLER_FILENAME, file);
      expect(exitCode).toBe(4);
      expect(existsSync(join(machine.dotaCfg("Steam"), "gamestate_integration"))).toBe(false);
    }
  }, 90_000);

  test("the uninstaller leaves the gamestate_integration folder and everything else in Dota alone", () => {
    const machine = fakeMachine({ libraries: [], dotaIn: ["Steam"] });
    const cfgDir = machine.dotaCfg("Steam");
    const integrations = join(cfgDir, "gamestate_integration");
    mkdirSync(integrations, { recursive: true });
    writeFileSync(join(integrations, GSI_CFG_FILENAME), CFG);
    writeFileSync(join(cfgDir, "autoexec.cfg"), "keep");
    expect(run(machine, GSI_WINDOWS_UNINSTALLER_FILENAME, buildWindowsGsiUninstaller()).exitCode).toBe(0);
    expect(existsSync(integrations)).toBe(true);
    expect(readdirSync(integrations)).toEqual([]);
    expect(readFileSync(join(cfgDir, "autoexec.cfg"), "utf8")).toBe("keep");
  }, 30_000);
});
