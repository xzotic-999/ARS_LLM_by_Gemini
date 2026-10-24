import { Request, Response, NextFunction } from "express";

interface ErrorWithStatus extends Error {
  status?: number;
}

export function errorHandler(
  err: ErrorWithStatus,
  req: Request,
  res: Response,
  next: NextFunction
) {
  console.error(err.stack);

  const status = err.status || 500;
  const message = status === 500 ? "Internal Server Error" : err.message;

  res.status(status).json({
    error: {
      message,
      status,
    },
  });
}