export type FeedbackKind = "problema" | "idea" | "sugerencia" | "consulta";
export type FeedbackState = "pendiente" | "en_revision" | "resuelto";

export const TYPE_ORDER: FeedbackKind[] = ["problema", "idea", "sugerencia", "consulta"];

export const TYPE_LABELS: Record<FeedbackKind, string> = {
  problema: "Problema",
  idea: "Idea",
  sugerencia: "Sugerencia",
  consulta: "Consulta",
};

export const STATUS_LABELS: Record<FeedbackState, string> = {
  pendiente: "Pendiente",
  en_revision: "En revisión",
  resuelto: "Resuelto",
};

export interface MyFeedback {
  id: string;
  createdAt: number;
  type: FeedbackKind;
  status: FeedbackState;
  message: string;
  route: string;
  images: Array<{ url: string; mime: string }>;
}
