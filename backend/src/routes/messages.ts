import { Router } from "express";
import { pool } from "../db/index.js";
import { requireAuth } from "../middleware/auth.js";
import {
  reserveQuota,
  checkQuota,
  recordUsage,
  getUserQuotaLimits,
} from "../services/quota.js";

const router = Router();

router.use(requireAuth);

// GET /api/v1/messages?conversation_id=X - list messages for a conversation
router.get("/", async (req, res, next) => {
  try {
    const conversationId = req.query.conversation_id
      ? parseInt(req.query.conversation_id as string, 10)
      : null;

    if (conversationId === null || isNaN(conversationId)) {
      res.status(400).json({
        error: { message: "conversation_id query parameter is required." },
      });
      return;
    }

    // Verify ownership
    const convCheck = await pool.query(
      "SELECT user_id FROM conversations WHERE id = $1",
      [conversationId]
    );

    if (convCheck.rows.length === 0) {
      res.status(404).json({ error: { message: "Conversation not found." } });
      return;
    }

    if (req.user!.role !== "admin" && convCheck.rows[0].user_id !== req.user!.id) {
      res.status(404).json({ error: { message: "Conversation not found." } });
      return;
    }

    const result = await pool.query(
      `SELECT id, conversation_id, role, text, created_at
       FROM messages
       WHERE conversation_id = $1
       ORDER BY created_at ASC, id ASC`,
      [conversationId]
    );

    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/messages - create a message
router.post("/", async (req, res, next) => {
  try {
    const { conversation_id, role, text, defer_quota_to_completion } = req.body;
    const userId = req.user!.id;

    if (!conversation_id || isNaN(parseInt(conversation_id, 10))) {
      res.status(400).json({ error: { message: "conversation_id is required." } });
      return;
    }

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      res.status(400).json({ error: { message: "Message text is required." } });
      return;
    }

    if (text.length > 50_000) {
      res.status(400).json({
        error: { message: "Message text must not exceed 50000 characters." },
      });
      return;
    }

    const validRoles = ["user", "assistant", "system"];
    if (role && !validRoles.includes(role)) {
      res.status(400).json({ error: { message: "Invalid message role." } });
      return;
    }

    // Verify conversation ownership
    const convCheck = await pool.query(
      "SELECT user_id FROM conversations WHERE id = $1",
      [conversation_id]
    );

    if (convCheck.rows.length === 0) {
      res.status(404).json({ error: { message: "Conversation not found." } });
      return;
    }

    if (req.user!.role !== "admin" && convCheck.rows[0].user_id !== req.user!.id) {
      res.status(404).json({ error: { message: "Conversation not found." } });
      return;
    }

    // For user messages: check quota (if defer_quota_to_completion is true, completion route reserves it;
    // otherwise reserve directly so standalone POST /api/v1/messages still enforces quota).
    if (role === "user" || !role) {
      const limits = await getUserQuotaLimits(userId);

      const dailyOk = defer_quota_to_completion
        ? (await checkQuota(userId, "daily", limits.daily.limit, limits.monthly.limit)).allowed
        : await reserveQuota(
            userId,
            "daily",
            limits.daily.limit,
            limits.monthly.limit
          );
      const monthlyOk = defer_quota_to_completion
        ? (await checkQuota(userId, "monthly", limits.daily.limit, limits.monthly.limit)).allowed
        : await reserveQuota(
            userId,
            "monthly",
            limits.daily.limit,
            limits.monthly.limit
          );

      if (!dailyOk || !monthlyOk) {
        res.status(429).json({
          error: {
            message: "Превышен лимит запросов. Обратитесь к администратору.",
          },
        });
        return;
      }
    }

    const result = await pool.query(
      `INSERT INTO messages (conversation_id, user_id, role, text)
       VALUES ($1, $2, $3, $4)
       RETURNING id, conversation_id, role, text, created_at`,
      [conversation_id, userId, role || "user", text.trim()]
    );

    // Update last_message_at on the conversation
    await pool.query(
      "UPDATE conversations SET last_message_at = CURRENT_TIMESTAMP WHERE id = $1",
      [conversation_id]
    );

    if (role === "user" || !role) {
      await recordUsage(userId, "message_sent", {
        conversation_id,
        text_length: text.trim().length,
      });
    }

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

export default router;