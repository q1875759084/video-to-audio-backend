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
 * Token 通过 Authorization: Bearer <token> header 传递。
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

/**
 * 文件下载专用鉴权中间件：同时支持 header token 和 query token。
 *
 * 为何允许 query token：
 * 浏览器原生下载（window.location.href / <a href>）无法附加自定义 header，
 * 必须将 token 放在 URL query string 中。这是业界通用做法（OSS 预签名 URL 同理）。
 *
 * 安全边界：
 * - 仅限 /api/file/:fileId/download 路由使用，不用于任何写操作接口
 * - token 有效期 1h，过期自动失效
 * - HTTPS 环境下 URL 在传输层加密，不会明文暴露
 */
export const fileDownloadAuthMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // 优先取 header，回退到 query string
  const authStr = req.headers.authorization;
  const queryToken = req.query.token as string | undefined;
  const token = authStr?.startsWith('Bearer ') ? authStr.split(' ')[1] : queryToken;

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
