const admin = require("firebase-admin");
const serviceAccount = require("../../roll-mate-firebase-adminsdk-dvpro-08ec4a8e36.json");

// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

module.exports = admin;
