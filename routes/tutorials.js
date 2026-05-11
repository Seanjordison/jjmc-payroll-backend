// routes/tutorials.js
// Manages the `tutorialVideos` Firestore collection.
const express = require("express");
const router  = express.Router();
const { db, admin } = require("../utils/firebaseAdmin");
const { verifyToken }  = require("../middleware/auth");
const { requireRole }  = require("../middleware/roleGuard");

// ─────────────────────────────────────────────────────────
// GET /api/tutorials
// All authenticated users can list tutorials.
// ─────────────────────────────────────────────────────────
router.get("/", verifyToken, async (req, res) => {
  try {
    const snapshot = await db
      .collection("tutorialVideos")
      .orderBy("createdAt", "desc")
      .get();

    const tutorials = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    return res.json({ tutorials });
  } catch (err) {
    console.error("[GET /tutorials]", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// ─────────────────────────────────────────────────────────
// GET /api/tutorials/:id
// ─────────────────────────────────────────────────────────
router.get("/:id", verifyToken, async (req, res) => {
  try {
    const snap = await db.collection("tutorialVideos").doc(req.params.id).get();
    if (!snap.exists) return res.status(404).json({ error: "Tutorial not found." });
    return res.json({ tutorial: { id: snap.id, ...snap.data() } });
  } catch (err) {
    console.error("[GET /tutorials/:id]", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// ─────────────────────────────────────────────────────────
// POST /api/tutorials
// Create a tutorial record (admin only).
// The actual video file is uploaded directly to Cloudinary from the frontend;
// this endpoint just persists the metadata + Cloudinary URL.
// Body: { title, description, videoUrl, publicId, thumbnailUrl? }
// ─────────────────────────────────────────────────────────
router.post("/", verifyToken, requireRole("admin"), async (req, res) => {
  const { title, description, videoUrl, publicId, thumbnailUrl } = req.body;

  if (!title || !videoUrl || !publicId) {
    return res.status(400).json({
      error: "title, videoUrl, and publicId are required.",
    });
  }

  try {
    const docRef = await db.collection("tutorialVideos").add({
      title:        title.trim(),
      description:  description?.trim() || "",
      videoUrl,
      publicId,
      thumbnailUrl: thumbnailUrl || null,
      createdAt:    admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.status(201).json({ id: docRef.id, message: "Tutorial created." });
  } catch (err) {
    console.error("[POST /tutorials]", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// ─────────────────────────────────────────────────────────
// PUT /api/tutorials/:id  (admin only)
// ─────────────────────────────────────────────────────────
router.put("/:id", verifyToken, requireRole("admin"), async (req, res) => {
  const { createdAt, publicId, ...safeFields } = req.body;

  try {
    const ref  = db.collection("tutorialVideos").doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Tutorial not found." });

    await ref.update({
      ...safeFields,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.json({ message: "Tutorial updated." });
  } catch (err) {
    console.error("[PUT /tutorials/:id]", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// ─────────────────────────────────────────────────────────
// DELETE /api/tutorials/:id  (admin only)
// Note: does NOT delete the Cloudinary asset — call the deleteCloudinaryMedia
// Firebase Function from the frontend or add Cloudinary SDK here if needed.
// ─────────────────────────────────────────────────────────
router.delete("/:id", verifyToken, requireRole("admin"), async (req, res) => {
  try {
    const ref  = db.collection("tutorialVideos").doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Tutorial not found." });

    await ref.delete();
    return res.json({ message: "Tutorial deleted from Firestore." });
  } catch (err) {
    console.error("[DELETE /tutorials/:id]", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

module.exports = router;
