import type { ReactNode } from "react";

// <Dominio><Cosa>: aviso de Live (captura incompleta, error 409, conexión vencida, pick detectado). El tono va por regla lateral + título, nunca solo por color;
// el texto siempre es tinta. Conserva el `role` y el `data-testid` de cada aviso: un fallo de captura se ve y se anuncia, nunca es solo un color.

export type LiveNoticeTone = "warn" | "bad" | "info";

export interface LiveNoticeProps {
  tone: LiveNoticeTone;
  testId: string;
  role?: "alert" | "status";
  title?: string;
  children?: ReactNode;
}

function NoticeTitle({ title }: { title?: string }) {
  if (title === undefined) return null;
  return <span className="ll-notice-title">{title}</span>;
}

export function LiveNotice({ tone, testId, role = "alert", title, children }: LiveNoticeProps) {
  return (
    <div className="ll-notice" data-testid={testId} data-tone={tone} role={role}>
      <NoticeTitle title={title} />
      {children}
    </div>
  );
}
