import { resolve } from "node:dns/promises";

export type ConnectivityStatus = "dns_failed" | "http_failed" | "ok";

export function classifyConnectivityError(error: unknown): "dns_failed" | "http_failed" {
  const message = error instanceof Error ? error.message : String(error);
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  return /ENOTFOUND|EAI_AGAIN|SERVFAIL|name resolution/i.test(`${code} ${message}`) ? "dns_failed" : "http_failed";
}

export async function diagnoseOpenDota(): Promise<{ status: ConnectivityStatus; detail: string }> {
  let addresses: string[];
  try { addresses = await resolve("api.opendota.com"); }
  catch { return { status: "dns_failed", detail: "DNS no resuelve api.opendota.com" }; }
  try {
    const response = await fetch("https://api.opendota.com/api/health");
    return response.ok
      ? { status: "ok", detail: `DNS=${addresses.join(",")} HTTP=${response.status}` }
      : { status: "http_failed", detail: `DNS=${addresses.join(",")} HTTP=${response.status}` };
  } catch (error) { return { status: "http_failed", detail: error instanceof Error ? error.message : String(error) }; }
}

if (import.meta.main) console.log(JSON.stringify(await diagnoseOpenDota(), null, 2));
