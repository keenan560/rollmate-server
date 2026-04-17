const admin = require("firebase-admin");

// Initialize Firebase Admin
// In production, load service account from FIREBASE_SERVICE_ACCOUNT env var (base64-encoded JSON)
// In development/UAT, fall back to the local service account file
let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(
    Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, "base64").toString(),
  );
} else {
  serviceAccount = require("../../roll-mate-firebase-adminsdk-dvpro-08ec4a8e36.json");
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

module.exports = admin;
