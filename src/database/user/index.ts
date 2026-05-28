import { db } from '../index.js';
import bcrypt from 'bcryptjs';

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  nickname: string | null;
  created_at: string;
}

/** 初始化 users 表 */
export function initUserTable(): void {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      username     TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      nickname     TEXT,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  console.log('✅ users 表初始化完成');
}

/** 写入预设账号（初期硬编码，已存在则跳过）*/
export async function seedPresetUsers(): Promise<void> {
  // 预设账号从环境变量读取，未配置时使用默认值（仅开发用）
  const presets = [
    {
      username: process.env.PRESET_USER_1 || 'admin',
      password: process.env.PRESET_PASS_1 || 'changeme123',
      nickname: process.env.PRESET_NICK_1 || '管理员',
    },
  ];

  for (const preset of presets) {
    const exists = db.prepare('SELECT 1 FROM users WHERE username = ?').get(preset.username);
    if (!exists) {
      const hash = await bcrypt.hash(preset.password, 10);
      db.prepare('INSERT INTO users (username, password_hash, nickname) VALUES (?, ?, ?)').run(
        preset.username,
        hash,
        preset.nickname,
      );
      console.log(`✅ 预设账号已创建：${preset.username}`);
    }
  }
}

/** 根据用户名查询用户 */
export function findUserByUsername(username: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;
}

/** 根据 ID 查询用户 */
export function findUserById(id: number): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
}
