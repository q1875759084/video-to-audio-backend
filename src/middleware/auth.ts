import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt.js';

// 扩展 Express 类型：给 req 挂载 userId
declare global {
  namespace Express {
    interface Request {
      userId?: number;
    }
  }
}

/**
 * JWT 鉴权中间件（标准版）
 * Token 只从 Authorization: Bearer <token> header 读取。
 * 适用于所有常规 API 路由。
 */
export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const authStr = req.headers.authorization;
  const token = authStr?.startsWith('Bearer ') ? authStr.split(' ')[1] : null;

  if (!token) {
    return res.status(401).json({ code: 401, message: '未登录，Token 缺失' });
  }

  try {
    const payload = verifyToken(token);
    req.userId = payload.userId;
    next();
  } catch {
    return res.status(401).json({ code: 401, message: 'Token 无效或已过期' });
  }
};

/**
 * JWT 鉴权中间件（文件预览专用）
 * 优先从 Authorization: Bearer <token> header 读取；
 * 其次从 ?token= query 参数读取。
 *
 * <audio src> / <video src> 等原生标签无法设置自定义 header，
 * 需要将 token 放在 URL query 中才能让浏览器原生发起 Range 请求实现流式播放。
 * 仅限 /api/file/* 路由使用，不对其他路由开放，避免扩大 query token 的适用范围。
 */
export const fileAuthMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const authStr = req.headers.authorization;
  const headerToken = authStr?.startsWith('Bearer ') ? authStr.split(' ')[1] : null;
  const queryToken = typeof req.query.token === 'string' ? req.query.token : null;

  const token = headerToken ?? queryToken;
  if (!token) {
    return res.status(401).json({ code: 401, message: '未登录，Token 缺失' });
  }

  try {
    const payload = verifyToken(token);
    req.userId = payload.userId;
    next();
  } catch {
    return res.status(401).json({ code: 401, message: 'Token 无效或已过期' });
  }
};
