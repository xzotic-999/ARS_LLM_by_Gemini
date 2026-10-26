import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  fetchWeatherData,
  fetchExchangeRatesData,
} from "../services/externalTools.js";
import {
  extractAndValidateAttachmentNode,
  MAX_ATTACHMENT_FILE_BYTES,
} from "../services/attachmentExtractor.js";

const router = Router();

router.use(requireAuth);

// GET /api/v1/tools/weather?city=Алматы
router.get("/weather", async (req, res, next) => {
  try {
    const rawCity =
      typeof req.query.city === "string" && req.query.city.trim()
        ? req.query.city.trim()
        : "Алматы";

    const result = await fetchWeatherData(rawCity);
    if (!result.available) {
      res.status(503).json(result);
      return;
    }
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/tools/rates?base=USD&symbols=KZT,EUR,RUB,CNY&amount=1
router.get("/rates", async (req, res, next) => {
  try {
    const baseCurrency =
      typeof req.query.base === "string" && req.query.base.trim()
        ? req.query.base.trim().toUpperCase()
        : "USD";

    const targetCurrencies =
      typeof req.query.symbols === "string" && req.query.symbols.trim()
        ? req.query.symbols
            .split(",")
            .map((s) => s.trim().toUpperCase())
            .filter(Boolean)
        : ["KZT", "EUR", "RUB", "CNY", "GBP"];

    const rawAmount = Number(req.query.amount ?? 1);
    const amount = Number.isFinite(rawAmount) && rawAmount > 0 ? rawAmount : 1;

    const result = await fetchExchangeRatesData({
      baseCurrency,
      targetCurrencies,
      amount,
    });

    if (!result.available) {
      res.status(503).json(result);
      return;
    }
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/attachments/extract
router.post("/attachments/extract", (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const mimeType =
    typeof body.mimeType === "string"
      ? body.mimeType.trim()
      : "application/octet-stream";
  const contentBase64 =
    typeof body.contentBase64 === "string" ? body.contentBase64.trim() : "";

  if (!name) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Не указано имя файла вложения.",
      },
    });
    return;
  }

  let bytes: Uint8Array;
  try {
    bytes = Buffer.from(contentBase64, "base64");
  } catch {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Некорректное кодирование файла (ожидается Base64).",
      },
    });
    return;
  }

  if (bytes.byteLength > MAX_ATTACHMENT_FILE_BYTES) {
    res.status(413).json({
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: "Размер файла превышает допустимый лимит 10 МБ.",
      },
    });
    return;
  }

  const extracted = extractAndValidateAttachmentNode({
    name,
    mimeType,
    bytes,
  });

  res.status(200).json(extracted);
});

export default router;
