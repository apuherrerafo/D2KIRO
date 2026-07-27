import type { ClientMessage, DraftSocket, ServerMessage } from "./types";

// Implementación real de DraftSocket sobre el WebSocket del navegador sobre /ws/draft
// (apps/engine, TSK-010). En pruebas se usa FakeSocket en su lugar (costura S5).
export function createDraftSocket(url: string): DraftSocket {
  const ws = new WebSocket(url);
  let messageHandler: ((message: ServerMessage) => void) | null = null;
  let closeHandler: (() => void) | null = null;

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
