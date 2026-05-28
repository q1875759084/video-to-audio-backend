import {
  getUserHistory,
  getHistoryById,
  deleteHistoryById,
  type HistoryRow,
} from '../../database/history/index.js';

class HistoryService {
  /** 获取用户历史记录 */
  getHistory(userId: number): HistoryRow[] {
    return getUserHistory(userId);
  }

  /** 删除历史记录（鉴权：只能删除自己的记录）*/
  deleteHistory(userId: number, historyId: number): void {
    const row = getHistoryById(historyId);
    if (!row) {
      throw new Error('记录不存在');
    }
    if (row.user_id !== userId) {
      throw new Error('无权限删除他人记录');
    }
    deleteHistoryById(historyId);
  }
}

export default new HistoryService();
