// routes/users.js
const express = require("express");
const router  = express.Router();
const { db, admin } = require("../utils/firebaseAdmin");
const { verifyToken }  = require("../middleware/auth");
const { requireRole }  = require("../middleware/roleGuard");

const VALID_ROLES = ["admin", "bookkeeper", "client-staff"];

// ─────────────────────────────────────────────────────────
// GET /api/users
// List all users (admin only).
// ─────────────────────────────────────────────────────────
router.get("/", verifyToken, requireRole("admin"), async (req, res) => {
  try {
    const snapshot = await db.collection("users").get();
    const users = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    return res.json({ users });
  } catch (err) {
    console.error("[GET /users]", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// ─────────────────────────────────────────────────────────
// GET /api/users/bookkeepers
// List users whose role === "bookkeeper" (admin only).
// ─────────────────────────────────────────────────────────
router.get("/bookkeepers", verifyToken, requireRole("admin"), async (req, res) => {
  try {
    const snapshot = await db
      .collection("users")
      .where("role", "==", "bookkeeper")
      .get();

    const bookkeepers = snapshot.docs.map((d) => ({
      id: d.id,
      ...d.data(),
    }));

    return res.json({ bookkeepers });
  } catch (err) {
    console.error("[GET /users/bookkeepers]", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// ─────────────────────────────────────────────────────────
// GET /api/users/me
// Get the calling user's own profile.
// ─────────────────────────────────────────────────────────
router.get("/me", verifyToken, async (req, res) => {
  try {
    const snap = await db.collection("users").doc(req.user.uid).get();
    if (!snap.exists) {
      return res.status(404).json({ error: "User document not found." });
    }
    return res.json({ user: { id: snap.id, ...snap.data() } });
  } catch (err) {
    console.error("[GET /users/me]", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// ─────────────────────────────────────────────────────────
// GET /api/users/:uid
// Get a specific user profile.
// Admins can get any user; others can only get themselves.
// ─────────────────────────────────────────────────────────
router.get("/:uid", verifyToken, async (req, res) => {
  const { uid } = req.params;

  // Non-admins may only view their own profile
  if (req.user.role !== "admin" && req.user.uid !== uid) {
    return res.status(403).json({ error: "Forbidden." });
  }

  try {
    const snap = await db.collection("users").doc(uid).get();
    if (!snap.exists) {
      return res.status(404).json({ error: "User not found." });
    }
    return res.json({ user: { id: snap.id, ...snap.data() } });
  } catch (err) {
    console.error("[GET /users/:uid]", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// ─────────────────────────────────────────────────────────
// PUT /api/users/:uid
// Update a user's profile fields.
// Admins can update anyone; others only themselves.
// Role changes are NOT allowed through this route — use /role instead.
// ─────────────────────────────────────────────────────────
router.put("/:uid", verifyToken, async (req, res) => {
  const { uid } = req.params;

  if (req.user.role !== "admin" && req.user.uid !== uid) {
    return res.status(403).json({ error: "Forbidden." });
  }

  // Strip fields that must not be updated via this endpoint
  const { role, createdAt, ...safeFields } = req.body;

  if (Object.keys(safeFields).length === 0) {
    return res.status(400).json({ error: "No valid fields provided to update." });
  }

  try {
    const ref  = db.collection("users").doc(uid);
    const snap = await ref.get();
    if (!snap.exists) {
      return res.status(404).json({ error: "User not found." });
    }

    await ref.update({
      ...safeFields,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.json({ message: "User updated successfully." });
  } catch (err) {
    console.error("[PUT /users/:uid]", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// ─────────────────────────────────────────────────────────
// POST /api/users/:uid/role
// Set a user's role (admin only).
// ─────────────────────────────────────────────────────────
router.post("/:uid/role", verifyToken, requireRole("admin"), async (req, res) => {
  const { uid } = req.params;
  const { role } = req.body;

  if (!role || !VALID_ROLES.includes(role)) {
    return res.status(400).json({
      error: `Invalid role. Valid roles: ${VALID_ROLES.join(", ")}`,
    });
  }

  try {
    const ref  = db.collection("users").doc(uid);
    const snap = await ref.get();
    if (!snap.exists) {
      return res.status(404).json({ error: "User not found." });
    }

    await ref.update({
      role,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.json({ message: `Role "${role}" assigned to user ${uid}.` });
  } catch (err) {
    console.error("[POST /users/:uid/role]", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// ─────────────────────────────────────────────────────────
// DELETE /api/users/:uid  (admin only — soft delete via disabled flag)
// ─────────────────────────────────────────────────────────
router.delete("/:uid", verifyToken, requireRole("admin"), async (req, res) => {
  const { uid } = req.params;

  try {
    const ref  = db.collection("users").doc(uid);
    const snap = await ref.get();
    if (!snap.exists) {
      return res.status(404).json({ error: "User not found." });
    }

    await ref.update({
      disabled: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.json({ message: `User ${uid} disabled.` });
  } catch (err) {
    console.error("[DELETE /users/:uid]", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

module.exports = router;
