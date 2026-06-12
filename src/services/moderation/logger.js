// Persists every moderation decision to the moderation_logs table.
// Logging failures must never break the request path, so everything is
// wrapped and swallowed (with a console error) here.

const supabase = require("../../../config");

async function logModerationDecision(entry) {
  try {
    const { error } = await supabase.from("moderation_logs").insert({
      user_id: entry.userId || null,
      content_type: entry.contentType,
      surface: entry.surface,
      decision: entry.decision,
      vendor: entry.vendor || null,
      scores: entry.scores || null,
      matched_categories:
        entry.matched && entry.matched.length ? entry.matched : null,
      reason: entry.reason || null,
      content_ref: entry.contentRef || null,
      content_excerpt: entry.excerpt ? entry.excerpt.slice(0, 500) : null,
      needs_review: entry.needsReview || false,
    });

    if (error) {
      console.error(
        "[moderation] failed to write moderation_logs:",
        error.message,
      );
    }
  } catch (e) {
    console.error("[moderation] logger exception:", e.message);
  }
}

module.exports = { logModerationDecision };
