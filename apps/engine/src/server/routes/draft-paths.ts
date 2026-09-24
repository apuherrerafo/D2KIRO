import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import {
  getAllDraftFeedback,
  getAllRecommendationFeedback,
  getRecommendationFeedbackByTarget,
  insertDraftFeedback,
  insertRecommendationFeedback,
  type FeedbackNegativeReason,
} from "../../db/queries";
import { buildDraftPaths } from "../../draft-paths/build-paths";
import { loadHeroCapabilities } from "../../draft-paths/capabilities";
import type { HeroCapabilities } from "../../draft-paths/types";
import { getCachedMetaSnapshot } from "../../meta/provider";
import type { SessionStore } from "../session";
import type { ProtocolSessionStore } from "../protocol-session";

const MAX_FEEDBACK_COMMENT_LENGTH = 4000;
const MAX_RECOMMENDATION_COMMENT_LENGTH = 1000;

const ALLOWED_NEGATIVE_REASONS = new Set<string>([
  "wrong_position",
  "poor_hero",
  "questionable_counter",
  "unclear_explanation",
  "not_useful",
  "other",
]);

const SENSITIVE_TOKEN_PATTERN = /(?:api[_-]?key|secret|password|bearer|session_secret)[\s:=]+[A-Za-z0-9_\-]{16,}/i;
const OPAQUE_HEX_OR_B64_SECRET = /\b(?:d2k_[A-Za-z0-9_\-]{32,}|[A-Fa-f0-9]{40,}|[A-Za-z0-9+/=]{48,})\b/;

export interface DraftPathsRouteDeps<TSchema extends Record<string, unknown>> {
  db: BunSQLiteDatabase<TSchema>;
  sessionStore: SessionStore;
  protocolSessionStore?: ProtocolSessionStore;
  heroCapabilities?: HeroCapabilities[];
  requireAccount?: (request: Request, allowUnknown?: boolean) => { ok: true; accountId: number | null } | { ok: false; response: Response };
}

function isValidDraftFeedbackBody(value: unknown): value is { comment: string; draftState: unknown; suggestions: unknown } {
  if (typeof value !== "object" || value === null) return false;
  const body = value as Record<string, unknown>;
  if (typeof body.comment !== "string" || body.comment.length === 0 || body.comment.length > MAX_FEEDBACK_COMMENT_LENGTH) return false;
  if (typeof body.draftState !== "object" || body.draftState === null) return false;
  return body.suggestions === null || typeof body.suggestions === "object";
}

function isRecommendationFeedbackBody(value: unknown): value is {
  rating: unknown;
  heroId?: unknown;
  targetPosition?: unknown;
  reason?: unknown;
  comment?: unknown;
  stateIdentity?: unknown;
  rulesetVersion?: unknown;
} {
  return typeof value === "object" && value !== null && "rating" in (value as Record<string, unknown>);
}

export function createDraftPathsRoutes<TSchema extends Record<string, unknown>>(deps: DraftPathsRouteDeps<TSchema>) {
  function parseSessionId(pathname: string): string | null {
    const match = /^\/api\/session\/([^/]+)\/draft-paths$/.exec(pathname);
    if (!match) return null;
    return decodeURIComponent(match[1]!);
  }

  async function get(sessionId: string): Promise<Response> {
    const state = deps.sessionStore.get(sessionId);
    const meta = await getCachedMetaSnapshot(deps.db, null);
    const capabilities = deps.heroCapabilities ?? loadHeroCapabilities();
    return Response.json(buildDraftPaths(state, meta, capabilities));
  }

  function parseFeedbackSessionId(pathname: string): string | null {
    const match = /^\/api\/session\/([^/]+)\/(?:feedback|recommendation-feedback)$/.exec(pathname);
    if (!match) return null;
    return decodeURIComponent(match[1]!);
  }

  async function handleRecommendationFeedback(
    request: Request,
    sessionId: string,
    body: {
      rating: unknown;
      heroId?: unknown;
      targetPosition?: unknown;
      reason?: unknown;
      comment?: unknown;
      stateIdentity?: unknown;
      rulesetVersion?: unknown;
    },
  ): Promise<Response> {
    // 1. Authorization: verify account token when authentication is configured.
    let accountId: number | null = null;
    if (deps.requireAccount) {
      const auth = deps.requireAccount(request, true);
      if (!auth.ok) return auth.response;
      accountId = auth.accountId;
    }

    // 2. Validate session existence where current architecture supports verification.
    if (typeof sessionId !== "string" || sessionId.trim().length === 0 || sessionId.includes("/") || sessionId.includes("\n")) {
      return Response.json({ error: "invalid_session_id" }, { status: 400 });
    }

    const protoSession = deps.protocolSessionStore?.get(sessionId);
    const legacySessionExists = deps.sessionStore?.has(sessionId);
    if (deps.protocolSessionStore && !protoSession && !legacySessionExists) {
      return Response.json({ error: "session_not_found" }, { status: 404 });
    }

    // 3. Validate rating
    if (body.rating !== "positive" && body.rating !== "negative") {
      return Response.json({ error: "invalid_rating" }, { status: 400 });
    }
    const rating = body.rating as "positive" | "negative";

    // 4. Validate heroId
    if (typeof body.heroId !== "number" || !Number.isInteger(body.heroId) || body.heroId < 1 || body.heroId > 200) {
      return Response.json({ error: "invalid_hero_id" }, { status: 400 });
    }
    const heroId = body.heroId;

    // 5. Validate targetPosition (optional, 1..5)
    let targetPosition: number | null = null;
    if (body.targetPosition !== undefined && body.targetPosition !== null) {
      if (
        typeof body.targetPosition !== "number" ||
        !Number.isInteger(body.targetPosition) ||
        body.targetPosition < 1 ||
        body.targetPosition > 5
      ) {
        return Response.json({ error: "invalid_target_position" }, { status: 400 });
      }
      targetPosition = body.targetPosition;
    }

    // 6. Validate reason
    let reason: FeedbackNegativeReason | null = null;
    if (rating === "positive") {
      if (body.reason !== undefined && body.reason !== null) {
        return Response.json({ error: "reason_not_allowed_for_positive_rating" }, { status: 400 });
      }
    } else {
      if (body.reason !== undefined && body.reason !== null) {
        if (typeof body.reason !== "string" || !ALLOWED_NEGATIVE_REASONS.has(body.reason)) {
          return Response.json({ error: "invalid_reason" }, { status: 400 });
        }
        reason = body.reason as FeedbackNegativeReason;
      }
    }

    // 7. Validate comment (optional, max 1000 chars, no secrets)
    let comment: string | null = null;
    if (body.comment !== undefined && body.comment !== null) {
      if (typeof body.comment !== "string") {
        return Response.json({ error: "invalid_comment" }, { status: 400 });
      }
      if (body.comment.length > MAX_RECOMMENDATION_COMMENT_LENGTH) {
        return Response.json({ error: "comment_too_long" }, { status: 400 });
      }
      if (SENSITIVE_TOKEN_PATTERN.test(body.comment) || OPAQUE_HEX_OR_B64_SECRET.test(body.comment)) {
        return Response.json({ error: "sensitive_data_rejected" }, { status: 400 });
      }
      const trimmed = body.comment.trim();
      comment = trimmed.length > 0 ? trimmed : null;
    }

    // 8. Validate stateIdentity and ruleset info
    let stateIdentity: string | null = null;
    if (typeof body.stateIdentity === "string" && body.stateIdentity.length > 0 && body.stateIdentity.length <= 128) {
      stateIdentity = body.stateIdentity;
    }

    let rulesetId: string | null = null;
    let rulesetVersion: string | null = null;
    if (protoSession) {
      rulesetId = protoSession.ruleset.id;
      const meta = deps.protocolSessionStore?.metadata(sessionId);
      rulesetVersion = meta?.patch ?? protoSession.ruleset.version;
    }
    if (!rulesetVersion && typeof body.rulesetVersion === "string" && body.rulesetVersion.length <= 64) {
      rulesetVersion = body.rulesetVersion;
    }

    // 9. Prevent repeated submissions
    const existing = getRecommendationFeedbackByTarget(deps.db, sessionId, heroId, stateIdentity);
    if (existing.length > 0) {
      return Response.json(
        { accepted: false, error: "duplicate_submission", message: "Feedback already submitted for this recommendation" },
        { status: 409 },
      );
    }

    // 10. Persist recommendation feedback
    insertRecommendationFeedback(deps.db, {
      sessionId,
      heroId,
      targetPosition,
      rating,
      reason,
      comment,
      stateIdentity,
      rulesetId,
      rulesetVersion,
      accountId,
      createdAt: new Date().toISOString(),
    });

    return Response.json({ accepted: true }, { status: 202 });
  }

  // Handles both recommendation feedback (MVP player feedback) and legacy QA report.
  async function feedbackPost(request: Request, sessionId: string): Promise<Response> {
    const body: unknown = await request.json().catch(() => null);

    if (isRecommendationFeedbackBody(body)) {
      return handleRecommendationFeedback(request, sessionId, body);
    }

    if (!isValidDraftFeedbackBody(body)) {
      return Response.json({ error: "invalid_body" }, { status: 400 });
    }

    insertDraftFeedback(deps.db, {
      sessionId,
      comment: body.comment,
      draftState: body.draftState,
      suggestions: body.suggestions,
      createdAt: new Date().toISOString(),
    });
    return Response.json({ accepted: true }, { status: 202 });
  }

  async function feedbackGet(): Promise<Response> {
    return Response.json(getAllDraftFeedback(deps.db));
  }

  async function recommendationFeedbackGet(filterSessionId?: string | null): Promise<Response> {
    const all = getAllRecommendationFeedback(deps.db);
    if (filterSessionId) {
      return Response.json(all.filter((r) => r.sessionId === filterSessionId));
    }
    return Response.json(all);
  }

  return {
    parseSessionId,
    get,
    parseFeedbackSessionId,
    feedbackPost,
    feedbackGet,
    recommendationFeedbackGet,
  };
}
