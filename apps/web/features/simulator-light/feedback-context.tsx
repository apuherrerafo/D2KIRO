"use client";

import { createContext, useContext, type ReactNode } from "react";

// El 👍/👎 por recomendación vivía SOLO en el Copilot eliminado (6b0bb3d2). Vuelve como UN control dentro del análisis del candidato abierto en el tablero
// (no como panel duplicado). El tablero es genérico (lo usa también Live): solo quien provee este contexto -- el Simulador, que tiene sesión y decisión V4 --
// muestra el control; sin proveedor no se pinta nada.
export interface RecommendationFeedbackTarget {
  sessionId: string;
  /** Identidad del estado de la decisión V4 sobre la que se opina (evita votar dos veces la misma recomendación). */
  stateIdentity: string;
  rulesetVersion: string | null;
}

const FeedbackTargetContext = createContext<RecommendationFeedbackTarget | null>(null);

export function RecommendationFeedbackProvider({ target, children }: { target: RecommendationFeedbackTarget | null; children: ReactNode }) {
  return <FeedbackTargetContext.Provider value={target}>{children}</FeedbackTargetContext.Provider>;
}

export function useRecommendationFeedbackTarget(): RecommendationFeedbackTarget | null {
  return useContext(FeedbackTargetContext);
}
