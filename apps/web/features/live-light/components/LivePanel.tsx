import type { ReactNode } from "react";
import { Glass } from "@/design/canonical/primitives";

// <Dominio><Cosa>: superficie protagonista de una sección de Live. Vidrio canónico (`Glass` nivel b) sobre el fondo Light; el contenedor exterior conserva
// el rol, el nombre accesible y el `data-testid` que ya usaban las pantallas, para que ni el lector de pantalla ni las pruebas noten el cambio de piel.

export interface LivePanelProps {
  testId?: string;
  /** Nombre accesible del grupo; ausente = sin rol de grupo (la barra de estado). */
  label?: string;
  compact?: boolean;
  children: ReactNode;
}

export function LivePanel({ testId, label, compact = false, children }: LivePanelProps) {
  const role = label === undefined ? undefined : "group";
  return (
    <div aria-label={label} className="ll-host" data-testid={testId} role={role}>
      <Glass className="ll-panel" surfaceLevel="3">
        <div className="ll-panel-inner" data-compact={compact}>{children}</div>
      </Glass>
    </div>
  );
}
