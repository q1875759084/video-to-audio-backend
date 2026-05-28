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
 * 支持两种 token 传递方式：
 * 1. Authorization: Bearer <token>（标准方式，用于所有接口，包括 SSE）
 *    SSE 使用 @microsoft/fetch-event-source 实现，可直接设置请求头，无需 URL 传 token
 * 2. URL query ?token=<token>（降级兼容，用于 <a> 标签直接下载等无法设置 header 的场景）
 */
export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // 优先从 Authorization header 读取
  let token: string | undefined;
  const authStr = req.headers.authorization;
  if (authStr && authStr.startsWith('Bearer ')) {
    token = authStr.split(' ')[1];
  }

  // 降级：从 URL query 参数读取（EventSource、下载链接场景）
  if (!token && req.query.token) {
    token = req.query.token as string;
  }

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
