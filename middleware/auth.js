// middleware/auth.js
// Verifies the Firebase ID token in the Authorization header.
// Attaches req.user = { uid, email, role } on success.

const { auth, db } = require("../utils/firebaseAdmin");

const VALID_ROLES = ["admin", "bookkeeper", "client-staff"];

/**
 * Verify Firebase ID token from "Authorization: Bearer <token>" header.
 * Loads the caller's role from Firestore `users` collection.
 */
async function verifyToken(req, res, next) {
  const header = req.headers.authorization || "";

  if (!header.startsWith("Bearer ")) {
    return res.status(401).json({
      error: "Unauthorized",
      message: "Missing or malformed Authorization header. Expected: Bearer <idToken>",
    });
  }

  const token = header.split(" ")[1];

  try {
    const decoded = await auth.verifyIdToken(token);

    // Load role from Firestore (source of truth in this project)
    let role = "client-staff"; // safe default
    try {
      const snap = await db.collection("users").doc(decoded.uid).get();
      if (snap.exists) {
        const data = snap.data();
        const firestoreRole = data?.role?.toLowerCase();
        if (VALID_ROLES.includes(firestoreRole)) role = firestoreRole;
      }
    } catch (firestoreErr) {
      console.warn("[auth] Could not load role from Firestore:", firestoreErr.message);
    }

    req.user = {
      uid:   decoded.uid,
      email: decoded.email || null,
      role,
    };

    next();
  } catch (err) {
    console.error("[auth] Token verification failed:", err.code || err.message);
    return res.status(401).json({
      error: "Unauthorized",
      message: "Invalid or expired token.",
    });
  }
}

module.exports = { verifyToken };
