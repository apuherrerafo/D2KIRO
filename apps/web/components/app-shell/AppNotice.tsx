import type { ReactNode } from "react";
import { D2Icon, type IconName } from "@/design/round-3b/icons";

// Un solo aviso para todas las pantallas: un icono, las palabras y una regla a la izquierda. El tono (la regla) es
// solo el tercer canal -- quien no distingue colores igual lee "Error" / "Listo" por el glifo y el título.

export type NoticeTone = "info" | "success" | "warning" | "error";

const TONE_ICON: Record<NoticeTone, IconName> = {
  info: "signal",
  success: "confirm",
  warning: "attention",
  error: "attention",
};

interface AppNoticeProps {
  tone: NoticeTone;
  title: string;
  children?: ReactNode;
  testId?: string;
}

export function AppNotice({ tone, title, children, testId }: AppNoticeProps) {
  const role = tone === "error" ? "alert" : "status";
  return (
    <div className="ap-notice" data-tone={tone} data-testid={testId} role={role}>
      <D2Icon name={TONE_ICON[tone]} size={16} />
      <div className="ap-notice-body">
        <span className="ap-notice-title">{title}</span>
        {children}
      </div>
    </div>
  );
}
