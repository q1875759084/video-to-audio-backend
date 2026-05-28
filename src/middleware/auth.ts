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
 * JWT 鉴权中间件
 * Token 通过 Authorization: Bearer <token> 传递。
 * <audio>/<a download> 等无法设置 header 的场景，
 * 前端统一使用 fetch + Blob URL 方案，不依赖 URL 传 token。
 */
export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const authStr = req.headers.authorization;
  if (!authStr || !authStr.startsWith('Bearer ')) {
    return res.status(401).json({ code: 401, message: '未登录，Token 缺失' });
  }

  const token = authStr.split(' ')[1];
  try {
    const payload = verifyToken(token);
    req.userId = payload.userId;
    next();
  } catch {
    return res.status(401).json({ code: 401, message: 'Token 无效或已过期' });
  }
};
