import { Request, Response } from 'express';
import UserService from '../../services/user/index.js';
import { success, fail } from '../../utils/response.js';

class UserController {
  async login(req: Request, res: Response) {
    try {
      const { account, password } = req.body;
      const result = await UserService.login(account, password);

      // RefreshToken 写入 HttpOnly Cookie
      res.cookie('refresh_token', result.refreshToken, {
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60 * 1000,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/api/user/refresh',
      });

      success(res, { userInfo: result.userInfo, accessToken: result.accessToken }, '登录成功');
    } catch (err: unknown) {
      fail(res, 400, err instanceof Error ? err.message : '登录失败');
    }
  }

  async getProfile(req: Request, res: Response) {
    try {
      const userInfo = await UserService.getProfile(req.userId!);
      success(res, { userInfo });
    } catch (err: unknown) {
      fail(res, 400, err instanceof Error ? err.message : '获取用户信息失败');
    }
  }

  async refresh(req: Request, res: Response) {
    try {
      const refreshToken = req.cookies?.refresh_token;
      if (!refreshToken) {
        return fail(res, 401, '未提供刷新凭证，请重新登录');
      }
      const result = await UserService.refreshToken(refreshToken);
      res.cookie('refresh_token', result.refreshToken, {
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60 * 1000,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/api/user/refresh',
      });
      success(res, { accessToken: result.accessToken }, '刷新成功');
    } catch (err: unknown) {
      res.clearCookie('refresh_token', { path: '/api/user/refresh' });
      fail(res, 401, '刷新凭证无效或已过期，请重新登录');
    }
  }

  async logout(_req: Request, res: Response) {
    res.clearCookie('refresh_token', { path: '/api/user/refresh' });
    success(res, null, '退出成功');
  }
}

export default new UserController();
