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

/** 写入预设账号（已存在则跳过）
 *
 * 试验阶段无注册功能，账号直接写死在代码里。
 * 待后续支持正式注册流程后，此函数可整体删除。
 */
export async function seedPresetUsers(): Promise<void> {
  const presets = [
    { username: 'cmj', password: 'cmj0531', nickname: 'cmj' },
    { username: 'ndy', password: 'ndy1224', nickname: 'ndy' },
    { username: 'mjiang', password: 'im2b', nickname: 'mjiang' },
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
