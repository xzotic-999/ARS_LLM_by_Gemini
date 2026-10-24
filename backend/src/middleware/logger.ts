import { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";

export function logger(req: Request, res: Response, next: NextFunction) {
  const requestId = randomUUID();
  const start = Date.now();
  console.log(`REQ ${requestId} ${req.method} ${req.path}`);

  res.on("finish", () => {
    const duration = Date.now() - start;
    console.log(`RES ${requestId} ${res.statusCode} ${duration}ms`);
  });

  next();
}