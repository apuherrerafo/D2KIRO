const CLOCK_RELAY_PATH = /^\/api\/session\/protocol\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/test-advance-clock$/i;

/**
 * The Linux certification harness exposes exactly one engine test seam. Keeping
 * this predicate here makes the relay auditable and prevents it becoming a
 * general-purpose engine proxy.
 */
export function isAllowedClockRelayRequest(method: string, pathname: string): boolean {
  return method === "POST" && CLOCK_RELAY_PATH.test(pathname);
}

function requiredTestRuntime(): void {
  if (process.env.E2E_TEST_RUNTIME !== "1") {
    throw new Error("start-e2e-runtime.ts requires E2E_TEST_RUNTIME=1");
  }
}

function port(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${name} must be a valid TCP port`);
  }
  return value;
}

async function waitForEngine(engine: ReturnType<typeof Bun.spawn>, enginePort: number): Promise<void> {
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${enginePort}/api/health`);
      if (response.ok) return;
    } catch {
      // The engine owns the loopback port and may still be booting.
    }

    if (engine.exitCode !== null) {
      throw new Error("apps/engine exited before becoming healthy");
    }
    await Bun.sleep(1_000);
  }

  throw new Error("apps/engine did not become healthy after 60 seconds");
}

function terminate(process: ReturnType<typeof Bun.spawn> | undefined): void {
  if (process?.exitCode === null) process.kill();
}

async function main(): Promise<void> {
  requiredTestRuntime();

  const enginePort = port("ENGINE_PORT", 4000);
  const relayPort = port("E2E_RELAY_PORT", 4100);
  const webPort = port("PORT", 3000);
  let engine: ReturnType<typeof Bun.spawn> | undefined;
  let web: ReturnType<typeof Bun.spawn> | undefined;
  let relay: ReturnType<typeof Bun.serve> | undefined;

  try {
    engine = Bun.spawn(["bun", "src/index.e2e.ts"], {
      cwd: "/app/apps/engine",
      stdout: "inherit",
      stderr: "inherit",
    });
    await waitForEngine(engine, enginePort);

    relay = Bun.serve({
      hostname: "0.0.0.0",
      port: relayPort,
      async fetch(request) {
        const url = new URL(request.url);
        if (!isAllowedClockRelayRequest(request.method, url.pathname)) {
          return new Response("Not Found", { status: 404 });
        }

        try {
          const response = await fetch(`http://127.0.0.1:${enginePort}${url.pathname}`, {
            method: "POST",
            headers: { "content-type": request.headers.get("content-type") ?? "application/json" },
            body: request.body,
          });
          return new Response(response.body, { status: response.status });
        } catch {
          return new Response("Engine unavailable", { status: 503 });
        }
      },
    });
    console.info(`[dota2coach-e2e] test-only clock relay listening on ${relayPort}`);

    web = Bun.spawn(["node", "./node_modules/next/dist/bin/next", "start", "-H", "::", "-p", String(webPort)], {
      cwd: "/app/apps/web",
      stdout: "inherit",
      stderr: "inherit",
    });

    const exitCode = await Promise.race([engine.exited, web.exited]);
    process.exitCode = exitCode;
  } finally {
    relay?.stop(true);
    terminate(engine);
    terminate(web);
    await Promise.all([engine?.exited, web?.exited].filter(Boolean));
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
