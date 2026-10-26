import { Router } from "express";
import { pool } from "../db/index.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

// All conversation routes require authentication.
router.use(requireAuth);

// GET /api/v1/conversations - list the current user's conversations
router.get("/", async (req, res, next) => {
  try {
    const userId = req.user!.id;

    const result = await pool.query(
      `SELECT id, title, created_at, last_message_at
       FROM conversations
       WHERE user_id = $1
       ORDER BY last_message_at DESC, created_at DESC`,
      [userId]
    );

    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/conversations/:id - get a single conversation
router.get("/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      res.status(400).json({ error: { message: "Invalid conversation id." } });
      return;
    }

    const result = await pool.query(
      "SELECT id, title, user_id, created_at, last_message_at FROM conversations WHERE id = $1",
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: { message: "Conversation not found." } });
      return;
    }

    const conv = result.rows[0];

    // Employees can only access their own conversations.
    if (req.user!.role !== "admin" && conv.user_id !== req.user!.id) {
      res.status(404).json({ error: { message: "Conversation not found." } });
      return;
    }

    res.json(conv);
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/conversations - create a new conversation
router.post("/", async (req, res, next) => {
  try {
    const { title } = req.body;
    const userId = req.user!.id;

    if (!title || typeof title !== "string" || title.trim().length === 0) {
      res.status(400).json({ error: { message: "Title is required." } });
      return;
    }

    if (title.length > 255) {
      res.status(400).json({ error: { message: "Title must not exceed 255 characters." } });
      return;
    }

    const result = await pool.query(
      `INSERT INTO conversations (title, user_id)
       VALUES ($1, $2)
       RETURNING id, title, created_at, last_message_at`,
      [title.trim(), userId]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/conversations/:id - rename a conversation
router.patch("/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      res.status(400).json({ error: { message: "Invalid conversation id." } });
      return;
    }

    const { title } = req.body;

    if (!title || typeof title !== "string" || title.trim().length === 0) {
      res.status(400).json({ error: { message: "Title is required." } });
      return;
    }

    if (title.length > 255) {
      res.status(400).json({ error: { message: "Title must not exceed 255 characters." } });
      return;
    }

    // Ownership check
    const ownerCheck = await pool.query(
      "SELECT user_id FROM conversations WHERE id = $1",
      [id]
    );

    if (ownerCheck.rows.length === 0) {
      res.status(404).json({ error: { message: "Conversation not found." } });
      return;
    }

    if (req.user!.role !== "admin" && ownerCheck.rows[0].user_id !== req.user!.id) {
      res.status(404).json({ error: { message: "Conversation not found." } });
      return;
    }

    const result = await pool.query(
      `UPDATE conversations
       SET title = $1
       WHERE id = $2
       RETURNING id, title, created_at, last_message_at`,
      [title.trim(), id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/conversations/:id - delete a conversation
router.delete("/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      res.status(400).json({ error: { message: "Invalid conversation id." } });
      return;
    }

    // Ownership check
    const ownerCheck = await pool.query(
      "SELECT user_id FROM conversations WHERE id = $1",
      [id]
    );

    if (ownerCheck.rows.length === 0) {
      res.status(404).json({ error: { message: "Conversation not found." } });
      return;
    }

    if (req.user!.role !== "admin" && ownerCheck.rows[0].user_id !== req.user!.id) {
      res.status(404).json({ error: { message: "Conversation not found." } });
      return;
    }

    await pool.query("DELETE FROM conversations WHERE id = $1", [id]);

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;