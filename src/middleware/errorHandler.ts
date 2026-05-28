import { Request, Response, NextFunction } from 'express';

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  console.error('[errorHandler]', err);
  res.status(500).json({
    code: 500,
    message: '服务器内部错误',
    data: null,
  });
}
