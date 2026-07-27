import type { ClientMessage, DraftSocket, ServerMessage } from "./types";

// Costura S5 (.claude/rules/testing-seams.md): el socket es la frontera reemplazada en las
// pruebas de la vista de draft — nunca un WebSocket real contra apps/engine corriendo.
export class FakeSocket implements DraftSocket {
  readonly sentMessages: ClientMessage[] = [];
  private onServerMessage: ((message: ServerMessage) => void) | null = null;
  private onSocketClose: (() => void) | null = null;

  onMessage(handler: (message: ServerMessage) => void): void {
    this.onServerMessage = handler;
  }

  onClose(handler: () => void): void {
    this.onSocketClose = handler;
  }

  send(message: ClientMessage): void {
    this.sentMessages.push(message);
  }

  close(): void {
    this.onServerMessage = null;
  }

  // Helpers de prueba: simulan eventos entrantes del servidor.
  emit(message: ServerMessage): void {
    this.onServerMessage?.(message);
  }

  emitClose(): void {
    this.onSocketClose?.();
  }
}
