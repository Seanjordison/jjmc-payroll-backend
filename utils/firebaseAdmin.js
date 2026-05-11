// utils/firebaseAdmin.js
// Initializes the Firebase Admin SDK once and exports the db + auth.

const admin = require("firebase-admin");

let _initialized = false;

function initAdmin() {
  if (_initialized) return;

  // ── Option A: service account JSON file ──────────────────────────────
  if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    const serviceAccount = require(
      require("path").resolve(process.env.FIREBASE_SERVICE_ACCOUNT_PATH)
    );
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: process.env.FIREBASE_PROJECT_ID,
    });

  // ── Option B: base64-encoded service account (for cloud deploy) ──────
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    const json = Buffer.from(
      process.env.FIREBASE_SERVICE_ACCOUNT_BASE64,
      "base64"
    ).toString("utf8");
    const serviceAccount = JSON.parse(json);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: process.env.FIREBASE_PROJECT_ID,
    });

  // ── Option C: Application Default Credentials (GCP / Cloud Run) ──────
  } else {
    admin.initializeApp({
      projectId: process.env.FIREBASE_PROJECT_ID,
    });
  }

  _initialized = true;
  console.log(
    `[Firebase] Admin SDK initialized — project: ${process.env.FIREBASE_PROJECT_ID}`
  );
}

initAdmin();

const db   = admin.firestore();
const auth = admin.auth();

module.exports = { admin, db, auth };
