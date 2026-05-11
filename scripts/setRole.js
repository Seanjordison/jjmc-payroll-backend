#!/usr/bin/env node
// scripts/setRole.js
// CLI utility to manually assign a role to a user.
// Usage: node scripts/setRole.js <UID> <role>
// Example: node scripts/setRole.js abc123uid bookkeeper

"use strict";
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const { db, auth } = require("../utils/firebaseAdmin");
const admin = require("firebase-admin");

const VALID_ROLES = ["admin", "bookkeeper", "client-staff"];

async function run() {
  const [, , uid, role] = process.argv;

  if (!uid || !role) {
    console.error("❌  Usage: node scripts/setRole.js <UID> <role>");
    console.error("    Valid roles:", VALID_ROLES.join(", "));
    process.exit(1);
  }

  if (!VALID_ROLES.includes(role)) {
    console.error(`❌  Invalid role "${role}". Valid roles: ${VALID_ROLES.join(", ")}`);
    process.exit(1);
  }

  try {
    // Verify the Firebase Auth user exists
    const userRecord = await auth.getUser(uid);
    console.log(`👤  Found user: ${userRecord.email || userRecord.uid}`);

    // Update Firestore users document
    const ref = db.collection("users").doc(uid);
    await ref.set(
      {
        role,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    console.log(`✅  Role "${role}" set for user ${uid}`);
    console.log("⚠️   The user must refresh their ID token (sign out & back in).");
    process.exit(0);
  } catch (err) {
    console.error("🔥  Error:", err.message || err);
    process.exit(1);
  }
}

run();
