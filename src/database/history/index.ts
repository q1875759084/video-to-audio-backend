import { db } from '../index.js';
import { deleteFile } from '../../utils/cleanup.js';

const HISTORY_LIMIT = 30; // 每个用户最多保留的历史记录数

export interface HistoryRow {
  id: number;
  user_id: number;
  task_id: string;
  file_id: string;
  original_name: string;
  format: string;
  file_size: number;
  duration: number;
  created_at: string;
}

export function initHistoryTable(): void {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS history (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       INTEGER NOT NULL,
      task_id       TEXT NOT NULL,
      file_id       TEXT NOT NULL,
      original_name TEXT NOT NULL,
      format        TEXT NOT NULL,
      file_size     INTEGER DEFAULT 0,
      duration      REAL DEFAULT 0,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `).run();
  console.log('✅ history 表初始化完成');
}

export function createHistory(data: Omit<HistoryRow, 'id' | 'created_at'>): void {
  db.prepare(`
    INSERT INTO history (user_id, task_id, file_id, original_name, format, file_size, duration)
    VALUES (@user_id, @task_id, @file_id, @original_name, @format, @file_size, @duration)
  `).run(data);

  // 写入后检查是否超限，超限删除最旧的记录和对应文件
  enforceHistoryLimit(data.user_id);
}

/** 获取用户历史记录（按时间倒序，最多 30 条）*/
export function getUserHistory(userId: number): HistoryRow[] {
  return db.prepare(`
    SELECT * FROM history WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
  `).all(userId, HISTORY_LIMIT) as HistoryRow[];
}

/** 获取单条历史记录（用于权限校验）*/
export function getHistoryById(id: number): HistoryRow | undefined {
  return db.prepare('SELECT * FROM history WHERE id = ?').get(id) as HistoryRow | undefined;
}

/** 删除历史记录（同步删除文件）*/
export function deleteHistoryById(id: number): void {
  const row = getHistoryById(id);
  if (!row) return;
  // 先删文件，再删记录
  deleteFile(row.file_id, row.format);
  db.prepare('DELETE FROM history WHERE id = ?').run(id);
}

/** 超限策略：超过 HISTORY_LIMIT 条则删除最旧的记录及文件 */
function enforceHistoryLimit(userId: number): void {
  const count = (db.prepare('SELECT COUNT(*) as cnt FROM history WHERE user_id = ?').get(userId) as { cnt: number }).cnt;

  if (count > HISTORY_LIMIT) {
    const overflow = count - HISTORY_LIMIT;
    const oldest = db.prepare(`
      SELECT * FROM history WHERE user_id = ? ORDER BY created_at ASC LIMIT ?
    `).all(userId, overflow) as HistoryRow[];

    for (const row of oldest) {
      deleteFile(row.file_id, row.format);
      db.prepare('DELETE FROM history WHERE id = ?').run(row.id);
    }
  }
}
