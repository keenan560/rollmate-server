// Content moderation orchestrator.
//
// Public API:
//   checkImage  ({ buffer, surface, userId, contentRef })   -> { allowed, decision, ... }
//   checkImages ({ buffers, surface, userId })              -> { allowed, index?, ... }
//   checkText   ({ text, surface, userId, contentRef })     -> { allowed, decision, ... }
//
// Policy:
//   - decision 'block'  -> allowed:false (caller rejects the upload/insert)
//   - decision 'review' -> allowed:true, but queued for human review
//   - vendor error      -> fail-open (allowed per config) + queued for review
//   - moderation off    -> allowed:true, decision 'skipped'
// Every call is written to moderation_logs.

const { config } = require("./config");
const imageMod = require("./imageModeration");
const textMod = require("./textModeration");
const { logModerationDecision } = require("./logger");

async function checkImage({
  buffer,
  surface,
  userId = null,
  contentRef = null,
}) {
  if (!config.enabled || !config.image.enabled) {
    return { allowed: true, decision: "skipped" };
  }

  try {
    const { vendor, annotation } = await imageMod.analyzeImage(buffer);
    const { decision, matched, review } = imageMod.evaluate(annotation);
    const allowed = decision !== "block";

    await logModerationDecision({
      userId,
      surface,
      contentType: "image",
      decision,
      vendor,
      scores: annotation,
      matched: decision === "block" ? matched : review,
      needsReview: decision === "review",
      contentRef,
      reason: matched.length ? matched.join(", ") : review.join(", ") || null,
    });

    return { allowed, decision, matched, review, vendor };
  } catch (err) {
    console.error(`[moderation] image check failed (${surface}):`, err.message);
    await logModerationDecision({
      userId,
      surface,
      contentType: "image",
      decision: "error",
      vendor: "google_vision",
      reason: err.message,
      needsReview: true,
      contentRef,
    });
    return { allowed: config.failOpen, decision: "error", error: err.message };
  }
}

// Scans multiple buffers; stops and reports the first one that is blocked.
async function checkImages({ buffers, surface, userId = null }) {
  for (let i = 0; i < buffers.length; i++) {
    const result = await checkImage({
      buffer: buffers[i],
      surface,
      userId,
      contentRef: `index:${i}`,
    });
    if (!result.allowed) return { allowed: false, index: i, ...result };
  }
  return { allowed: true, decision: "allow" };
}

async function checkText({ text, surface, userId = null, contentRef = null }) {
  if (!config.enabled || !config.text.enabled) {
    return { allowed: true, decision: "skipped" };
  }
  if (!text || !text.trim()) {
    return { allowed: true, decision: "empty" };
  }

  if (!config.openai.apiKey) {
    await logModerationDecision({
      userId,
      surface,
      contentType: "text",
      decision: "error",
      reason: "OPENAI_API_KEY not set",
      needsReview: true,
      contentRef,
      excerpt: text,
    });
    return { allowed: config.failOpen, decision: "error" };
  }

  try {
    const result = await textMod.analyzeText(text);
    const { decision, matched, review } = textMod.evaluate(result);
    const allowed = decision !== "block";

    await logModerationDecision({
      userId,
      surface,
      contentType: "text",
      decision,
      vendor: "openai",
      scores: result.category_scores,
      matched: decision === "block" ? matched : review,
      needsReview: decision === "review",
      contentRef,
      excerpt: text,
      reason: matched.length ? matched.join(", ") : review.join(", ") || null,
    });

    return { allowed, decision, matched, review };
  } catch (err) {
    console.error(`[moderation] text check failed (${surface}):`, err.message);
    await logModerationDecision({
      userId,
      surface,
      contentType: "text",
      decision: "error",
      vendor: "openai",
      reason: err.message,
      needsReview: true,
      contentRef,
      excerpt: text,
    });
    return { allowed: config.failOpen, decision: "error", error: err.message };
  }
}

module.exports = { checkImage, checkImages, checkText };
