// routes/inquiries.js
// Manages the `inquiries` collection and its `messages` subcollection.
const express = require("express");
const router  = express.Router();
const { db, admin } = require("../utils/firebaseAdmin");
const { verifyToken }  = require("../middleware/auth");
const { requireRole }  = require("../middleware/roleGuard");

// ─────────────────────────────────────────────────────────
// GET /api/inquiries
// - Admin + Bookkeeper: all inquiries
// - Client-staff: only inquiries they created
// ─────────────────────────────────────────────────────────
router.get("/", verifyToken, async (req, res) => {
  try {
    let query = db.collection("inquiries").orderBy("lastUpdated", "desc");

    const snapshot = await query.get();
    let inquiries = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));

    // Client-staff sees only their own
    if (req.user.role === "client-staff") {
      inquiries = inquiries.filter((i) => i.createdBy === req.user.uid);
    }

    return res.json({ inquiries });
  } catch (err) {
    console.error("[GET /inquiries]", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// ─────────────────────────────────────────────────────────
// POST /api/inquiries
// Create a new inquiry (client-staff only).
// Body: { title, body }
// ─────────────────────────────────────────────────────────
router.post("/", verifyToken, requireRole("client-staff"), async (req, res) => {
  const { title, body } = req.body;

  if (!title?.trim() || !body?.trim()) {
    return res.status(400).json({ error: "Both title and body are required." });
  }

  try {
    // Fetch author's name from Firestore
    let firstName = "Client";
    let lastName  = "";
    const userSnap = await db.collection("users").doc(req.user.uid).get();
    if (userSnap.exists) {
      const u = userSnap.data();
      firstName = u.firstName || u.displayName?.split(" ")[0] || "Client";
      lastName  = u.lastName  || u.displayName?.split(" ").slice(1).join(" ") || "";
    }

    const inquiryRef = await db.collection("inquiries").add({
      title:         title.trim(),
      body:          body.trim(),
      createdBy:     req.user.uid,
      authorFirstName: firstName,
      authorLastName:  lastName,
      askedTo:       "bookkeeper",
      status:        "open",
      createdAt:     admin.firestore.FieldValue.serverTimestamp(),
      lastUpdated:   admin.firestore.FieldValue.serverTimestamp(),
    });

    // Initial message (the question itself)
    await db.collection(`inquiries/${inquiryRef.id}/messages`).add({
      body:          body.trim(),
      createdBy:     req.user.uid,
      messageType:   "question",
      isAnswer:      false,
      approved:      true,
      createdAt:     admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.status(201).json({ id: inquiryRef.id, message: "Inquiry created." });
  } catch (err) {
    console.error("[POST /inquiries]", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// ─────────────────────────────────────────────────────────
// GET /api/inquiries/:id
// Get a single inquiry (access rules enforced).
// ─────────────────────────────────────────────────────────
router.get("/:id", verifyToken, async (req, res) => {
  try {
    const snap = await db.collection("inquiries").doc(req.params.id).get();
    if (!snap.exists) return res.status(404).json({ error: "Inquiry not found." });

    const data = snap.data();

    // Client-staff can only read their own inquiries
    if (req.user.role === "client-staff" && data.createdBy !== req.user.uid) {
      return res.status(403).json({ error: "Forbidden." });
    }

    return res.json({ inquiry: { id: snap.id, ...data } });
  } catch (err) {
    console.error("[GET /inquiries/:id]", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// ─────────────────────────────────────────────────────────
// GET /api/inquiries/:id/messages
// Get messages for an inquiry.
// Client-staff sees only their own messages + approved answers.
// Admin/Bookkeeper sees all messages.
// ─────────────────────────────────────────────────────────
router.get("/:id/messages", verifyToken, async (req, res) => {
  try {
    const inquirySnap = await db.collection("inquiries").doc(req.params.id).get();
    if (!inquirySnap.exists) return res.status(404).json({ error: "Inquiry not found." });

    const inquiryData = inquirySnap.data();
    if (req.user.role === "client-staff" && inquiryData.createdBy !== req.user.uid) {
      return res.status(403).json({ error: "Forbidden." });
    }

    const msgsSnap = await db
      .collection(`inquiries/${req.params.id}/messages`)
      .orderBy("createdAt", "asc")
      .get();

    let messages = msgsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // Client-staff: filter to own messages + approved answers
    if (req.user.role === "client-staff") {
      messages = messages.filter(
        (m) => m.createdBy === req.user.uid || (m.isAnswer && m.approved === true)
      );
    }

    return res.json({ messages });
  } catch (err) {
    console.error("[GET /inquiries/:id/messages]", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// ─────────────────────────────────────────────────────────
// POST /api/inquiries/:id/messages
// Add a reply (bookkeeper or admin).
// Body: { body }
// ─────────────────────────────────────────────────────────
router.post("/:id/messages", verifyToken, requireRole("bookkeeper", "admin"), async (req, res) => {
  const { body } = req.body;
  if (!body?.trim()) return res.status(400).json({ error: "Message body is required." });

  try {
    const inquiryRef  = db.collection("inquiries").doc(req.params.id);
    const inquirySnap = await inquiryRef.get();
    if (!inquirySnap.exists) return res.status(404).json({ error: "Inquiry not found." });

    const isBookkeeper = req.user.role === "bookkeeper";

    // Fetch author name
    let displayName = isBookkeeper ? "Bookkeeper" : "Admin";
    const userSnap = await db.collection("users").doc(req.user.uid).get();
    if (userSnap.exists) {
      const u = userSnap.data();
      displayName = [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email || displayName;
    }

    await db.collection(`inquiries/${req.params.id}/messages`).add({
      body:               body.trim(),
      createdBy:          req.user.uid,
      authorDisplayName:  displayName,
      authorRole:         req.user.role,
      messageType:        "answer",
      isAnswer:           true,
      needsAdminApproval: isBookkeeper,
      approved:           !isBookkeeper, // admin replies auto-approved
      createdAt:          admin.firestore.FieldValue.serverTimestamp(),
    });

    // Update inquiry status
    const newStatus = isBookkeeper ? "pending-admin" : "answered";
    await inquiryRef.update({
      status:      newStatus,
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Notify the inquiry author
    const inquiry = inquirySnap.data();
    try {
      await db.collection("users").doc(inquiry.createdBy).update({
        newNotification: `${inquiry.title} has a new reply.`,
      });
    } catch (_) { /* ignore */ }

    return res.status(201).json({ message: "Reply added.", status: newStatus });
  } catch (err) {
    console.error("[POST /inquiries/:id/messages]", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// ─────────────────────────────────────────────────────────
// POST /api/inquiries/:id/messages/:msgId/approve  (admin only)
// Approve a bookkeeper's reply so it becomes visible to client-staff.
// ─────────────────────────────────────────────────────────
router.post(
  "/:id/messages/:msgId/approve",
  verifyToken,
  requireRole("admin"),
  async (req, res) => {
    try {
      const msgRef = db
        .collection("inquiries")
        .doc(req.params.id)
        .collection("messages")
        .doc(req.params.msgId);

      const msgSnap = await msgRef.get();
      if (!msgSnap.exists) return res.status(404).json({ error: "Message not found." });

      await msgRef.update({
        approved:           true,
        needsAdminApproval: false,
      });

      const inquiryRef = db.collection("inquiries").doc(req.params.id);
      await inquiryRef.update({
        status:      "answered",
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Notify original author
      const inquirySnap = await inquiryRef.get();
      if (inquirySnap.exists) {
        try {
          await db.collection("users").doc(inquirySnap.data().createdBy).update({
            newNotification: `${inquirySnap.data().title} has been answered.`,
          });
        } catch (_) { /* ignore */ }
      }

      return res.json({ message: "Reply approved." });
    } catch (err) {
      console.error("[POST /inquiries/:id/messages/:msgId/approve]", err);
      return res.status(500).json({ error: "Internal server error." });
    }
  }
);

// ─────────────────────────────────────────────────────────
// POST /api/inquiries/:id/messages/:msgId/reject  (admin only)
// Body: { reason }
// ─────────────────────────────────────────────────────────
router.post(
  "/:id/messages/:msgId/reject",
  verifyToken,
  requireRole("admin"),
  async (req, res) => {
    const { reason } = req.body;

    try {
      const msgRef = db
        .collection("inquiries")
        .doc(req.params.id)
        .collection("messages")
        .doc(req.params.msgId);

      const msgSnap = await msgRef.get();
      if (!msgSnap.exists) return res.status(404).json({ error: "Message not found." });

      await msgRef.update({
        approved:           false,
        rejected:           true,
        needsAdminApproval: false,
        rejectionReason:    reason || "Rejected by admin",
      });

      const inquiryRef = db.collection("inquiries").doc(req.params.id);
      await inquiryRef.update({
        status:      "rejected",
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      });

      const inquirySnap = await inquiryRef.get();
      if (inquirySnap.exists) {
        try {
          await db.collection("users").doc(inquirySnap.data().createdBy).update({
            newNotification: `${inquirySnap.data().title} was rejected.${reason ? " Reason: " + reason : ""}`,
          });
        } catch (_) { /* ignore */ }
      }

      return res.json({ message: "Reply rejected." });
    } catch (err) {
      console.error("[POST /inquiries/:id/messages/:msgId/reject]", err);
      return res.status(500).json({ error: "Internal server error." });
    }
  }
);

// ─────────────────────────────────────────────────────────
// DELETE /api/inquiries/:id  (admin only)
// ─────────────────────────────────────────────────────────
router.delete("/:id", verifyToken, requireRole("admin"), async (req, res) => {
  try {
    const ref  = db.collection("inquiries").doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Inquiry not found." });

    // Delete subcollection messages first (Firestore does not cascade)
    const msgsSnap = await ref.collection("messages").get();
    const batch = db.batch();
    msgsSnap.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(ref);
    await batch.commit();

    return res.json({ message: "Inquiry and messages deleted." });
  } catch (err) {
    console.error("[DELETE /inquiries/:id]", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

module.exports = router;
