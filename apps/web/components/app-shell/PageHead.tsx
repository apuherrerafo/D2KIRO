import type { ReactNode } from "react";

interface PageHeadProps {
  kicker?: string;
  title: string;
  lede?: ReactNode;
}

export function PageHead({ kicker, title, lede }: PageHeadProps) {
  return (
    <header className="ap-head">
      {kicker && <p className="ap-kicker">{kicker}</p>}
      <h1 className="ap-title">{title}</h1>
      {lede && <p className="ap-lede">{lede}</p>}
    </header>
  );
}
