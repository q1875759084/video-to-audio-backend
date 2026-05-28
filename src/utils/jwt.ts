import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET;
if (!SECRET) {
  throw new Error('JWT_SECRET 环境变量未配置，应用拒绝启动');
}

const ACCESS_EXPIRES = '1h';
const REFRESH_EXPIRES = '7d';

export function generateTokens(userId: number) {
  const payload = { userId };
  const accessToken = jwt.sign(payload, SECRET, { expiresIn: ACCESS_EXPIRES });
  const refreshToken = jwt.sign(payload, SECRET, { expiresIn: REFRESH_EXPIRES });
  return { accessToken, refreshToken };
}

export function verifyToken(token: string): { userId: number } {
  return jwt.verify(token, SECRET) as { userId: number };
}
