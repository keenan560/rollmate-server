// Centralized, env-tunable moderation configuration.
//
// Thresholds live here (env-overridable) so they can be tightened/loosened
// WITHOUT a code change or redeploy. Defaults are conservative-but-sane for
// closed testing; tighten before public launch.
//
// ── Image (Google Cloud Vision SafeSearch) ──────────────────────────────────
// SafeSearch returns one of these likelihood buckets per category:
//   VERY_UNLIKELY < UNLIKELY < POSSIBLE < LIKELY < VERY_LIKELY
//
// ── Text (OpenAI moderation endpoint) ───────────────────────────────────────
// Returns a 0..1 score per category; we block/review against numeric thresholds.

require("dotenv").config();

const LIKELIHOOD_ORDER = [
  "UNKNOWN",
  "VERY_UNLIKELY",
  "UNLIKELY",
  "POSSIBLE",
  "LIKELY",
  "VERY_LIKELY",
];

// Is `value` at least as severe as `threshold`?
function likelihoodAtLeast(value, threshold) {
  const v = LIKELIHOOD_ORDER.indexOf(value);
  const t = LIKELIHOOD_ORDER.indexOf(threshold);
  if (v === -1 || t === -1) return false;
  return v >= t;
}

function csv(value, fallback) {
  return (value || fallback)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const config = {
  // Master switch + failure policy
  enabled: process.env.MODERATION_ENABLED !== "false", // default ON
  // fail-open: if a vendor errors, allow the content but queue it for review.
  // Set MODERATION_FAIL_OPEN=false to fail-closed (block on vendor error).
  failOpen: process.env.MODERATION_FAIL_OPEN !== "false", // default fail-open

  image: {
    enabled: process.env.MODERATION_IMAGE_ENABLED !== "false",
    // Block when a category likelihood is >= this bucket
    blockThreshold: process.env.MODERATION_IMAGE_BLOCK_THRESHOLD || "LIKELY",
    // Escalate to human review when >= this bucket but below block
    reviewThreshold:
      process.env.MODERATION_IMAGE_REVIEW_THRESHOLD || "POSSIBLE",
    // SafeSearch categories to enforce: adult, violence, racy, medical, spoof
    categories: csv(
      process.env.MODERATION_IMAGE_CATEGORIES,
      "adult,violence,racy",
    ),
  },

  text: {
    enabled: process.env.MODERATION_TEXT_ENABLED !== "false",
    model: process.env.MODERATION_TEXT_MODEL || "omni-moderation-latest",
    // Block if any enforced category score >= this (0..1)
    blockScore: parseFloat(process.env.MODERATION_TEXT_BLOCK_SCORE || "0.7"),
    // Escalate to review if score >= this but below block
    reviewScore: parseFloat(process.env.MODERATION_TEXT_REVIEW_SCORE || "0.4"),
    categories: csv(
      process.env.MODERATION_TEXT_CATEGORIES,
      "sexual,sexual/minors,hate,hate/threatening,harassment,harassment/threatening,violence,violence/graphic",
    ),
    // sexual/minors is treated with zero tolerance regardless of blockScore
    hardBlockCategories: csv(
      process.env.MODERATION_TEXT_HARD_BLOCK_CATEGORIES,
      "sexual/minors",
    ),
    hardBlockScore: parseFloat(
      process.env.MODERATION_TEXT_HARD_BLOCK_SCORE || "0.2",
    ),
  },

  google: {
    // Provide EITHER an API key (REST, simplest) ...
    apiKey: process.env.GOOGLE_VISION_API_KEY || null,
    // ... OR a service-account key file for the SDK
    // (falls back to GOOGLE_APPLICATION_CREDENTIALS / ambient creds on GCP).
    keyFilename:
      process.env.GOOGLE_VISION_KEY_FILE ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      null,
  },

  openai: {
    apiKey: process.env.OPENAI_API_KEY || null,
  },
};

module.exports = { config, LIKELIHOOD_ORDER, likelihoodAtLeast };
