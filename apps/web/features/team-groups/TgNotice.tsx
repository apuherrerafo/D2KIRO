import type { ReactNode } from "react";
import { D2Icon, type IconName } from "@/design/round-3b/icons";

// One notice for the whole screen: an icon, the words, a rule on the left. Hue (the rule) is only the third channel --
// a person who cannot tell the colours apart still reads "Error" / "Guardado" from the glyph and the title.

export type NoticeTone = "info" | "success" | "warning" | "error";

const TONE_ICON: Record<NoticeTone, IconName> = {
  info: "signal",
  success: "confirm",
  warning: "attention",
  error: "attention",
};

interface TgNoticeProps {
  tone: NoticeTone;
  title: string;
  children?: ReactNode;
}

export function TgNotice({ tone, title, children }: TgNoticeProps) {
  const role = tone === "error" ? "alert" : "status";
  return (
    <div className="tg-notice" data-tone={tone} role={role}>
      <D2Icon name={TONE_ICON[tone]} size={16} />
      <div className="tg-notice-body">
        <span className="tg-notice-title">{title}</span>
        {children}
      </div>
    </div>
  );
}
