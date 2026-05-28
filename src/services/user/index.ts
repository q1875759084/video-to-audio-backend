import bcrypt from 'bcryptjs';
import { findUserByUsername, findUserById } from '../../database/user/index.js';
import { generateTokens, verifyToken } from '../../utils/jwt.js';

class UserService {
  /** 用户登录（账号 = 用户名，无注册功能，账号由后端预设）*/
  async login(account: string, password: string) {
    if (!account || !password) {
      throw new Error('账号和密码不能为空');
    }

    const user = findUserByUsername(account);
    if (!user) {
      throw new Error('账号不存在');
    }

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      throw new Error('密码错误');
    }

    const { accessToken, refreshToken } = generateTokens(user.id);
    return {
      userInfo: {
        id: user.id,
        username: user.username,
        nickname: user.nickname || user.username,
      },
      accessToken,
      refreshToken,
    };
  }

  /** 获取用户信息 */
  async getProfile(userId: number) {
    const user = findUserById(userId);
    if (!user) throw new Error('用户不存在');
    return {
      id: user.id,
      username: user.username,
      nickname: user.nickname || user.username,
    };
  }

  /** 刷新 Token */
  async refreshToken(refreshT: string) {
    const payload = verifyToken(refreshT);
    const user = findUserById(payload.userId);
    if (!user) throw new Error('用户不存在');
    const { accessToken, refreshToken } = generateTokens(user.id);
    return { accessToken, refreshToken };
  }
}

export default new UserService();
