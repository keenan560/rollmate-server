// Turns a spoken (on-device dictated) training-log transcript into
// structured fields matching either a regular training log or a
// round-by-round sparring session — same shapes the manual forms already
// produce, so the save path afterward is unchanged.
//
// No audio ever reaches this service — transcription happens for free via
// the OS's built-in dictation on the client. This is purely the
// text-in/structured-JSON-out extraction step.

const { config } = require("./moderation/config");

const SCORING_ACTIONS = [
  "takedown",
  "sweep",
  "guard_pass",
  "mount",
  "back_take",
  "knee_on_belly",
];

const SUBMISSION_TYPES = [
  "armbar",
  "triangle",
  "rnc",
  "guillotine",
  "kimura",
  "americana",
  "ezekiel",
  "darce",
  "anaconda",
  "loop_choke",
  "bow_arrow",
  "cross_collar",
  "heel_hook",
  "knee_bar",
  "toe_hold",
  "ankle_lock",
  "wrist_lock",
  "omoplata",
  "north_south_choke",
  "baseball_choke",
  "other",
];

const TRAINING_TYPES = [
  "gi",
  "nogi",
  "both",
  "drilling",
  "open_mat",
  "private",
  "competition_prep",
  "video_study",
];

const INTENSITIES = ["light", "moderate", "hard", "competition"];

const SCHEMA = {
  name: "voice_training_log",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["log_type", "training", "sparring"],
    properties: {
      // Which shape actually applies — the other field is null.
      log_type: { type: "string", enum: ["training", "sparring"] },
      training: {
        type: ["object", "null"],
        additionalProperties: false,
        required: [
          "duration_minutes",
          "training_type",
          "intensity",
          "techniques_practiced",
          "sparring_rounds",
          "notes",
        ],
        properties: {
          duration_minutes: { type: "integer" },
          training_type: { type: "string", enum: TRAINING_TYPES },
          intensity: { type: "string", enum: INTENSITIES },
          techniques_practiced: { type: "array", items: { type: "string" } },
          sparring_rounds: { type: "integer" },
          notes: { type: "string" },
        },
      },
      sparring: {
        type: ["object", "null"],
        additionalProperties: false,
        required: ["training_type", "rounds", "notes"],
        properties: {
          training_type: { type: "string", enum: ["gi", "nogi", "both"] },
          notes: { type: "string" },
          rounds: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "round_number",
                "partner_name",
                "my_scores",
                "their_scores",
                "submissions",
              ],
              properties: {
                round_number: { type: "integer" },
                partner_name: { type: ["string", "null"] },
                my_scores: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["action", "count"],
                    properties: {
                      action: { type: "string", enum: SCORING_ACTIONS },
                      count: { type: "integer" },
                    },
                  },
                },
                their_scores: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["action", "count"],
                    properties: {
                      action: { type: "string", enum: SCORING_ACTIONS },
                      count: { type: "integer" },
                    },
                  },
                },
                submissions: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["by", "type"],
                    properties: {
                      by: { type: "string", enum: ["me", "them"] },
                      type: { type: "string", enum: SUBMISSION_TYPES },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

const SYSTEM_PROMPT = `You turn a BJJ practitioner's spoken, informal description of a training session into structured data.

Decide log_type:
- "sparring" if they describe specific rounds against an opponent with a score/result (takedowns, sweeps, passes, mounts, back takes, knee-on-belly, submissions landed or received).
- "training" for anything else — drilling, open mat, a regular class, technique work, video study — even if it casually mentions rolling without round-by-round detail.

Only fill in the object matching log_type; set the other to null.

For scoring actions and submission types, only use the exact enum values provided — never invent new ones. If something doesn't clearly match an enum value, omit it rather than guessing (e.g. an unclear submission name -> use "other").

Be conservative: only extract what's actually stated. Use 0 / empty arrays / "moderate" intensity for anything not mentioned rather than inventing detail. Duration: if not stated, estimate a reasonable default for the type of session described (60 for a normal class, 90 for open mat) rather than 0.

Critical rule for scoring: a submission does NOT imply any positional scoring happened before it. Do not add a takedown, sweep, guard_pass, mount, back_take, or knee_on_belly event unless the speaker explicitly names that specific action happening (e.g. "I passed his guard", "he took me down twice"). "He got me with a triangle" or "finished me with an armbar" — on their own, with nothing else described — means my_scores/their_scores stay empty and only the submission is recorded. Never pad a round's score to make it feel more "complete."

Critical rule for attribution: figure out WHO performed each action from the grammar, not just which words appear. The speaker is always "I/me/my". If "I" or "my" is the one doing the action, it goes in my_scores (I scored). If the opponent ("he/she/they") is the one doing the action to the speaker, it goes in their_scores (they scored) — even though the sentence contains "me". Example: "he took me down" = the opponent took a takedown, so this is their_scores, NOT my_scores, even though "me" appears in the sentence. "I took him down" = my_scores. Get this backwards and the whole round is wrong, so read each action carefully for who is the subject (the one doing it) vs. the object (the one it happened to).

Write "notes" as a short, cleaned-up first-person summary of what they said — not a verbatim transcript.`;

async function extractStructuredLog(transcript) {
  const apiKey = config.openai.apiKey;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.VOICE_LOG_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: transcript },
      ],
      response_format: { type: "json_schema", json_schema: SCHEMA },
      temperature: 0.2,
    }),
  });

  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(
      `OpenAI extraction error ${resp.status}: ${t.slice(0, 300)}`,
    );
  }

  const json = await resp.json();
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI extraction: empty response");
  return JSON.parse(content);
}

module.exports = { extractStructuredLog };
