// Image moderation via Google Cloud Vision SafeSearch.
//
// Supports two transports, auto-selected:
//   1. REST with an API key (GOOGLE_VISION_API_KEY) — no extra dependency.
//   2. The @google-cloud/vision SDK with a service-account key file — reuses
//      the existing Firebase/GCP identity.
//
// Both return the same SafeSearch annotation shape:
//   { adult, spoof, medical, violence, racy } each a likelihood bucket.

const { config, likelihoodAtLeast } = require("./config");

let sdkClientPromise = null;

async function getSdkClient() {
  if (!sdkClientPromise) {
    sdkClientPromise = (async () => {
      // Lazy require so the app still boots if the SDK isn't installed yet.
      const vision = require("@google-cloud/vision");
      const opts = {};
      if (config.google.keyFilename)
        opts.keyFilename = config.google.keyFilename;
      return new vision.ImageAnnotatorClient(opts);
    })();
  }
  return sdkClientPromise;
}

async function safeSearchViaRest(base64) {
  const url = `https://vision.googleapis.com/v1/images:annotate?key=${config.google.apiKey}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [
        {
          image: { content: base64 },
          features: [{ type: "SAFE_SEARCH_DETECTION" }],
        },
      ],
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Vision REST error ${resp.status}: ${text.slice(0, 300)}`);
  }

  const json = await resp.json();
  const apiErr = json.responses?.[0]?.error;
  if (apiErr) throw new Error(`Vision REST API error: ${apiErr.message}`);

  const ann = json.responses?.[0]?.safeSearchAnnotation;
  if (!ann) throw new Error("Vision REST: no safeSearchAnnotation in response");
  return ann;
}

async function safeSearchViaSdk(buffer) {
  const client = await getSdkClient();
  const [result] = await client.safeSearchDetection(buffer);
  const ann = result.safeSearchAnnotation;
  if (!ann) throw new Error("Vision SDK: no safeSearchAnnotation in response");
  return ann;
}

// Returns { vendor, annotation }
async function analyzeImage(buffer) {
  if (config.google.apiKey) {
    return {
      vendor: "google_vision_rest",
      annotation: await safeSearchViaRest(buffer.toString("base64")),
    };
  }
  if (config.google.keyFilename) {
    return {
      vendor: "google_vision_sdk",
      annotation: await safeSearchViaSdk(buffer),
    };
  }
  throw new Error(
    "Vision not configured: set GOOGLE_VISION_API_KEY or GOOGLE_VISION_KEY_FILE",
  );
}

// Map a SafeSearch annotation to a decision using configured thresholds.
// Returns { decision: 'allow'|'review'|'block', matched: [], review: [] }
function evaluate(annotation) {
  const matched = [];
  const review = [];

  for (const cat of config.image.categories) {
    const value = annotation[cat];
    if (!value) continue;
    if (likelihoodAtLeast(value, config.image.blockThreshold)) {
      matched.push(`${cat}:${value}`);
    } else if (likelihoodAtLeast(value, config.image.reviewThreshold)) {
      review.push(`${cat}:${value}`);
    }
  }

  let decision = "allow";
  if (matched.length) decision = "block";
  else if (review.length) decision = "review";

  return { decision, matched, review };
}

module.exports = { analyzeImage, evaluate };
