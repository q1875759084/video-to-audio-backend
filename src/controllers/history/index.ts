import { Request, Response } from 'express';
import HistoryService from '../../services/history/index.js';
import { success, fail } from '../../utils/response.js';
import type { HistoryRow } from '../../database/history/index.js';

// 将数据库行格式转换为前端期望的格式
function formatHistoryItem(row: HistoryRow) {
  return {
    id: row.id,
    fileId: row.file_id,
    originalName: row.original_name,
    format: row.format,
    status: 'done' as const,
    fileSize: row.file_size,
    duration: row.duration,
    createdAt: row.created_at,
  };
}

class HistoryController {
  async getHistory(req: Request, res: Response) {
    try {
      const list = HistoryService.getHistory(req.userId!);
      success(res, list.map(formatHistoryItem));
    } catch (err: unknown) {
      fail(res, 500, err instanceof Error ? err.message : '获取历史记录失败');
    }
  }

  async deleteHistory(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return fail(res, 400, '无效的记录 ID');
      }
      HistoryService.deleteHistory(req.userId!, id);
      success(res, null, '删除成功');
    } catch (err: unknown) {
      fail(res, 400, err instanceof Error ? err.message : '删除失败');
    }
  }
}

export default new HistoryController();
