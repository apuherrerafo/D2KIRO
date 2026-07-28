import type { ClientMessage, DraftSocket, ServerMessage } from "./types";

// Implementación real de DraftSocket sobre el WebSocket del navegador sobre /ws/draft
// (apps/engine, TSK-010). En pruebas se usa FakeSocket en su lugar (costura S5).
export function createDraftSocket(url: string): DraftSocket {
  const ws = new WebSocket(url);
  let messageHandler: ((message: ServerMessage) => void) | null = null;
  let closeHandler: (() => void) | null = null;
  // store.ts manda "hello" justo después de crear el socket, pero un WebSocket real arranca en
  // CONNECTING (nunca OPEN de forma síncrona) -- sin esta cola, ese primer mensaje se perdía en
  // silencio y la vista de draft se quedaba "desconectada" para siempre contra un motor real
  // (el FakeSocket de las pruebas nunca modela esta transición async, por eso no se detectó).
  const pending: ClientMessage[] = [];

  ws.addEventListener("open", () => {
    for (const message of pending.splice(0)) ws.send(JSON.stringify(message));
  });
  ws.addEventListener("message", (event: MessageEvent) => {
    try {
      const parsed = JSON.parse(String(event.data)) as ServerMessage;
      messageHandler?.(parsed);
    } catch {
      // Mensaje no es JSON válido -- se descarta en silencio, la vista sigue con lo último conocido.
    }
  });
  ws.addEventListener("close", () => closeHandler?.());
  ws.addEventListener("error", () => closeHandler?.());

  return {
    send(message: ClientMessage): void {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
      else if (ws.readyState === WebSocket.CONNECTING) pending.push(message);
    },
    close(): void {
      ws.close();
    },
    onMessage(next: (message: ServerMessage) => void): void {
      messageHandler = next;
    },
    onClose(next: () => void): void {
      closeHandler = next;
    },
  };
}
