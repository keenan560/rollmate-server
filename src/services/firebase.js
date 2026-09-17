const admin = require("firebase-admin");

// Initialize Firebase Admin.
// - Deployed (Render): FIREBASE_SERVICE_ACCOUNT env var (base64-encoded JSON).
// - Local dev: picks the matching local service account file for
//   APP_ENV (set by setup-env.sh), so it always matches whichever
//   SUPABASE_URL is active — no manual base64 juggling.
const SERVICE_ACCOUNT_FILES = {
  uat: "../../roll-mate-firebase-adminsdk-dvpro-1be56750ac.json",
  prod: "../../roll-mate-prod-firebase-adminsdk-fbsvc-47fb1b4389.json",
};

let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(
    Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, "base64").toString(),
  );
} else {
  const appEnv = process.env.APP_ENV === "prod" ? "prod" : "uat";
  serviceAccount = require(SERVICE_ACCOUNT_FILES[appEnv]);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

module.exports = admin;
