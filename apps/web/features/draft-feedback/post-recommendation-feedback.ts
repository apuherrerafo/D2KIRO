import { ENGINE_HTTP_BASE_URL } from "@/lib/engine-url";

export type FeedbackRating = "positive" | "negative";

export type FeedbackNegativeReason =
  | "wrong_position"
  | "poor_hero"
  | "questionable_counter"
  | "unclear_explanation"
  | "not_useful"
  | "other";

export interface PostRecommendationFeedbackInput {
  sessionId: string;
  heroId: number;
  rating: FeedbackRating;
  targetPosition?: number | null;
  reason?: FeedbackNegativeReason | null;
  comment?: string | null;
  stateIdentity?: string | null;
  rulesetVersion?: string | null;
}

export interface RecommendationFeedbackResult {
  accepted: boolean;
  error?: string;
}

export async function postRecommendationFeedback(
  input: PostRecommendationFeedbackInput,
): Promise<RecommendationFeedbackResult> {
  const { sessionId, heroId, rating, targetPosition, reason, comment, stateIdentity, rulesetVersion } = input;

  const payload: Record<string, unknown> = {
    rating,
    heroId,
  };
  if (targetPosition !== undefined && targetPosition !== null) {
    payload.targetPosition = targetPosition;
  }
  if (reason !== undefined && reason !== null) {
    payload.reason = reason;
  }
  if (comment !== undefined && comment !== null && comment.trim().length > 0) {
    payload.comment = comment.trim();
  }
  if (stateIdentity !== undefined && stateIdentity !== null) {
    payload.stateIdentity = stateIdentity;
  }
  if (rulesetVersion !== undefined && rulesetVersion !== null) {
    payload.rulesetVersion = rulesetVersion;
  }

  const response = await fetch(`${ENGINE_HTTP_BASE_URL}/api/session/${sessionId}/feedback`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let errorCode: string | undefined;
    try {
      const data = await response.json();
      errorCode = data?.error;
    } catch {
      // non-JSON response (e.g. 503 or HTML redirect)
    }
    return { accepted: false, error: errorCode ?? `http_${response.status}` };
  }

  return (await response.json()) as RecommendationFeedbackResult;
}
