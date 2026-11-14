"use client";

import { createContext, useContext, type ReactNode } from "react";

// El 👍/👎 por recomendación vivía SOLO en el Copilot eliminado (6b0bb3d2). Vuelve como UN control dentro del análisis del candidato abierto en el tablero
// (no como panel duplicado). El tablero es genérico (lo usa también Live): solo quien provee este contexto -- el Simulador, que tiene sesión y decisión V4 --
// muestra el control; sin proveedor no se pinta nada.
export interface RecommendationFeedbackTarget {
  sessionId: string;
  /** Posición que mira la decisión V4 vigente: el voto solo existe para SUS candidatos, nunca para los de otra columna del tablero. */
  viewedPosition: number;
  /** Héroes que esa decisión V4 propuso (tarjetas ranqueadas). Un candidato del tablero que no esté aquí no es "la recomendación" sobre la que se vota. */
  rankedHeroIds: readonly number[];
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
