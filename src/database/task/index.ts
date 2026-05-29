import { db } from '../index.js';

export type TaskStatus = 'pending' | 'processing' | 'done' | 'error';
export type TaskType = 'url' | 'upload';

export interface TaskRow {
  id: string;        // UUID
  user_id: number;
  type: TaskType;
  source: string;    // URL 或原始文件名
  format: string;    // 'mp3' | 'aac' | 'wav'
  status: TaskStatus;
  file_id: string | null;
  error_msg: string | null;
  created_at: string;
}

export function initTaskTable(): void {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS tasks (
      id        TEXT PRIMARY KEY,
      user_id   INTEGER NOT NULL,
      type      TEXT NOT NULL,
      source    TEXT NOT NULL,
      format    TEXT NOT NULL,
      status    TEXT DEFAULT 'pending',
      file_id   TEXT,
      error_msg TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `).run();
  console.log('✅ tasks 表初始化完成');
}

export function createTask(task: Omit<TaskRow, 'status' | 'file_id' | 'error_msg' | 'created_at'>): void {
  db.prepare(`
    INSERT INTO tasks (id, user_id, type, source, format)
    VALUES (@id, @user_id, @type, @source, @format)
  `).run(task);
}

export function updateTaskStatus(
  taskId: string,
  status: TaskStatus,
  fileId?: string,
  errorMsg?: string,
): void {
  db.prepare(`
    UPDATE tasks SET status = ?, file_id = ?, error_msg = ? WHERE id = ?
  `).run(status, fileId ?? null, errorMsg ?? null, taskId);
}

export function getTask(taskId: string): TaskRow | undefined {
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow | undefined;
}

/**
 * 根据 taskId 列表批量查询任务详情
 * 用于 429 响应时告知前端「是什么任务在占用配额」
 */
export function getTasksByIds(taskIds: string[]): TaskRow[] {
  if (taskIds.length === 0) return [];
  const placeholders = taskIds.map(() => '?').join(',');
  return db.prepare(
    `SELECT * FROM tasks WHERE id IN (${placeholders}) ORDER BY created_at DESC`
  ).all(...taskIds) as TaskRow[];
}
