import { db } from "./db/client";
import { OpenDotaClient } from "./meta/opendota-client";
import { createApp } from "./server/app";

const PORT = Number(process.env.ENGINE_PORT ?? 4000);

// El token nunca vive en el repo, ni como literal ni como default de fallback (security.md). Si
// no se provee por entorno, se genera uno al arrancar y se imprime una sola vez para que el
// capturador (Overwolf/simulador) lo lea y lo use en esa misma corrida del motor.
const captureToken = process.env.CAPTURE_TOKEN ?? crypto.randomUUID();
if (!process.env.CAPTURE_TOKEN) {
  console.log(`[dota2coach] CAPTURE_TOKEN no configurado — generado para esta corrida: ${captureToken}`);
}

const app = createApp({ db, openDotaClient: new OpenDotaClient(), captureToken });
const server = app.start("127.0.0.1", PORT);

console.log(`apps/engine escuchando en http://${server.hostname}:${server.port}`);
