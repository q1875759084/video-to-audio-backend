import { Response } from 'express';

export function success(res: Response, data?: unknown, message = '操作成功') {
  res.json({ code: 200, message, data: data ?? null });
}

export function fail(res: Response, code: number, message: string) {
  res.json({ code, message, data: null });
}
