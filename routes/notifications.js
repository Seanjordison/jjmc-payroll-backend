// routes/notifications.js
// Manages per-user notifications in the `notifications` collection.
const express = require("express");
const router  = express.Router();
const { db, admin } = require("../utils/firebaseAdmin");
const { verifyToken }  = require("../middleware/auth");
const { requireRole }  = require("../middleware/roleGuard");

// ─────────────────────────────────────────────────────────
// GET /api/notifications
// Get notifications for the authenticated user.
// ?unread=true to filter unread only.
// ─────────────────────────────────────────────────────────
router.get("/", verifyToken, async (req, res) => {
  try {
    let query = db
      .collection("notifications")
      .where("userId", "==", req.user.uid)
      .orderBy("createdAt", "desc");

    if (req.query.unread === "true") {
      query = query.where("read", "==", false);
    }

    const snapshot = await query.limit(50).get();
    const notifications = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    return res.json({ notifications });
  } catch (err) {
    console.error("[GET /notifications]", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// ─────────────────────────────────────────────────────────
// PUT /api/notifications/:id/read
// Mark a notification as read (owner only).
// ─────────────────────────────────────────────────────────
router.put("/:id/read", verifyToken, async (req, res) => {
  try {
    const ref  = db.collection("notifications").doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Notification not found." });

    if (snap.data().userId !== req.user.uid) {
      return res.status(403).json({ error: "Forbidden." });
    }

    await ref.update({ read: true });
    return res.json({ message: "Notification marked as read." });
  } catch (err) {
    console.error("[PUT /notifications/:id/read]", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// ─────────────────────────────────────────────────────────
// PUT /api/notifications/read-all
// Mark all of the caller's notifications as read.
// ─────────────────────────────────────────────────────────
router.put("/read-all", verifyToken, async (req, res) => {
  try {
    const snapshot = await db
      .collection("notifications")
      .where("userId", "==", req.user.uid)
      .where("read", "==", false)
      .get();

    const batch = db.batch();
    snapshot.docs.forEach((d) => batch.update(d.ref, { read: true }));
    await batch.commit();

    return res.json({ message: `${snapshot.size} notifications marked as read.` });
  } catch (err) {
    console.error("[PUT /notifications/read-all]", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// ─────────────────────────────────────────────────────────
// DELETE /api/notifications/:id  (owner or admin)
// ─────────────────────────────────────────────────────────
router.delete("/:id", verifyToken, async (req, res) => {
  try {
    const ref  = db.collection("notifications").doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Notification not found." });

    if (snap.data().userId !== req.user.uid && req.user.role !== "admin") {
      return res.status(403).json({ error: "Forbidden." });
    }

    await ref.delete();
    return res.json({ message: "Notification deleted." });
  } catch (err) {
    console.error("[DELETE /notifications/:id]", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

module.exports = router;
