import { Router } from "express";
import { pool } from "../db/index.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

// All conversation routes require authentication.
router.use(requireAuth);

export type ConversationListFilter = "active" | "archived" | "deleted" | "all";

export function parseConversationStatusFilter(rawStatus: unknown): ConversationListFilter {
  if (rawStatus === "archived" || rawStatus === "deleted" || rawStatus === "all") {
    return rawStatus;
  }
  return "active";
}

function buildStatusWhereClause(filter: ConversationListFilter): string {
  switch (filter) {
    case "archived":
      return "AND c.deleted_at IS NULL AND c.archived_at IS NOT NULL";
    case "deleted":
      return "AND c.deleted_at IS NOT NULL";
    case "all":
      return "";
    case "active":
    default:
      return "AND c.deleted_at IS NULL AND c.archived_at IS NULL";
  }
}

// GET /api/v1/conversations - list the current user's conversations with messages
// Supports ?status=active|archived|deleted|all (defaults to 'active' so deleted/archived chats do not leak into normal lists)
router.get("/", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const statusFilter = parseConversationStatusFilter(req.query.status);
    const statusClause = buildStatusWhereClause(statusFilter);

    const result = await pool.query(
      `SELECT
         c.id,
         c.title,
         c.created_at,
         c.last_message_at,
         c.archived_at,
         c.deleted_at,
         COALESCE(
           (
             SELECT json_agg(
               json_build_object(
                 'id', m.id,
                 'conversation_id', m.conversation_id,
                 'role', m.role,
                 'text', m.text,
                 'created_at', m.created_at
               )
               ORDER BY m.created_at ASC, m.id ASC
             )
             FROM messages m
             WHERE m.conversation_id = c.id
           ),
           '[]'::json
         ) AS messages
       FROM conversations c
       WHERE c.user_id = $1 ${statusClause}
       ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC`,
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
      "SELECT id, title, user_id, created_at, last_message_at, archived_at, deleted_at FROM conversations WHERE id = $1",
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
       RETURNING id, title, created_at, last_message_at, archived_at, deleted_at`,
      [title.trim(), userId]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/conversations/:id - rename, archive/unarchive, or soft-delete/restore a conversation
router.patch("/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      res.status(400).json({ error: { message: "Invalid conversation id." } });
      return;
    }

    const { title, archived, deleted } = req.body ?? {};
    const hasTitle = title !== undefined;
    const hasArchived = archived !== undefined;
    const hasDeleted = deleted !== undefined;

    if (!hasTitle && !hasArchived && !hasDeleted) {
      res.status(400).json({
        error: { message: "Provide title, archived, or deleted to update." },
      });
      return;
    }

    if (hasTitle) {
      if (typeof title !== "string" || title.trim().length === 0) {
        res.status(400).json({ error: { message: "Title is required." } });
        return;
      }
      if (title.length > 255) {
        res.status(400).json({ error: { message: "Title must not exceed 255 characters." } });
        return;
      }
    }

    if (hasArchived && typeof archived !== "boolean") {
      res.status(400).json({ error: { message: "archived must be a boolean." } });
      return;
    }

    if (hasDeleted && typeof deleted !== "boolean") {
      res.status(400).json({ error: { message: "deleted must be a boolean." } });
      return;
    }

    // Ownership check
    const ownerCheck = await pool.query(
      "SELECT user_id, archived_at, deleted_at FROM conversations WHERE id = $1",
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

    if (hasArchived && archived === true && ownerCheck.rows[0].deleted_at && deleted !== false) {
      res.status(409).json({
        error: { message: "Cannot archive a deleted conversation. Restore it first." },
      });
      return;
    }

    const setClauses: string[] = [];
    const params: unknown[] = [];

    if (hasTitle) {
      params.push(title.trim());
      setClauses.push(`title = $${params.length}`);
    }

    if (hasArchived) {
      if (archived) {
        setClauses.push("archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP)");
      } else {
        setClauses.push("archived_at = NULL");
      }
    }

    if (hasDeleted) {
      if (deleted) {
        setClauses.push("deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP)");
      } else {
        setClauses.push("deleted_at = NULL");
      }
    }

    params.push(id);
    const result = await pool.query(
      `UPDATE conversations
       SET ${setClauses.join(", ")}
       WHERE id = $${params.length}
       RETURNING id, title, created_at, last_message_at, archived_at, deleted_at`,
      params
    );

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/conversations/:id/restore - restore a deleted (or archived) conversation
router.post("/:id/restore", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      res.status(400).json({ error: { message: "Invalid conversation id." } });
      return;
    }

    const ownerCheck = await pool.query(
      "SELECT user_id, archived_at, deleted_at FROM conversations WHERE id = $1",
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

    const fromArchive = Boolean(req.body?.fromArchive);
    const updateSql = fromArchive
      ? `UPDATE conversations
         SET archived_at = NULL
         WHERE id = $1
         RETURNING id, title, created_at, last_message_at, archived_at, deleted_at`
      : `UPDATE conversations
         SET deleted_at = NULL
         WHERE id = $1
         RETURNING id, title, created_at, last_message_at, archived_at, deleted_at`;

    const result = await pool.query(updateSql, [id]);
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/conversations/:id - soft delete by default, or hard delete with ?permanent=true
router.delete("/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      res.status(400).json({ error: { message: "Invalid conversation id." } });
      return;
    }

    // Ownership check
    const ownerCheck = await pool.query(
      "SELECT user_id, deleted_at FROM conversations WHERE id = $1",
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

    const isPermanent =
      req.query.permanent === "true" || req.query.permanent === "1";

    if (isPermanent) {
      await pool.query("DELETE FROM conversations WHERE id = $1", [id]);
      res.status(204).send();
      return;
    }

    const result = await pool.query(
      `UPDATE conversations
       SET deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP)
       WHERE id = $1
       RETURNING id, title, created_at, last_message_at, archived_at, deleted_at`,
      [id]
    );

    res.status(200).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

export default router;