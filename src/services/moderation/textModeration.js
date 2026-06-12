// Text moderation via OpenAI's moderation endpoint (free, purpose-built for
// sexual / hate / harassment / violence text). Used for post captions,
// profile text, and chat messages.

const { config } = require("./config");

// Returns the raw OpenAI moderation result for the input string.
async function analyzeText(text) {
  const resp = await fetch("https://api.openai.com/v1/moderations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.openai.apiKey}`,
    },
    body: JSON.stringify({ model: config.text.model, input: text }),
  });

  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(
      `OpenAI moderation error ${resp.status}: ${t.slice(0, 300)}`,
    );
  }

  const json = await resp.json();
  const result = json.results?.[0];
  if (!result) throw new Error("OpenAI moderation: empty results");
  return result;
}

// Map a moderation result to a decision using configured thresholds.
// Returns { decision: 'allow'|'review'|'block', matched: [], review: [] }
function evaluate(result) {
  const scores = result.category_scores || {};
  const matched = [];
  const review = [];

  // Zero-tolerance categories (e.g. sexual/minors) block at a much lower score.
  for (const cat of config.text.hardBlockCategories) {
    const score = scores[cat];
    if (typeof score === "number" && score >= config.text.hardBlockScore) {
      matched.push(`${cat}:${score.toFixed(3)}`);
    }
  }

  for (const cat of config.text.categories) {
    if (config.text.hardBlockCategories.includes(cat)) continue;
    const score = scores[cat];
    if (typeof score !== "number") continue;
    if (score >= config.text.blockScore) {
      matched.push(`${cat}:${score.toFixed(3)}`);
    } else if (score >= config.text.reviewScore) {
      review.push(`${cat}:${score.toFixed(3)}`);
    }
  }

  let decision = "allow";
  if (matched.length) decision = "block";
  else if (review.length) decision = "review";

  return { decision, matched, review };
}

module.exports = { analyzeText, evaluate };
