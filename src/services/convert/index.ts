import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import type { Response } from 'express';
import { downloadWithYtdlp } from './ytdlp.js';
import { convertToAudio, getAudioDuration, type OutputFormat } from './ffmpeg.js';
import { createTask, updateTaskStatus } from '../../database/task/index.js';
import { createHistory } from '../../database/history/index.js';
import { getFilePath, cleanupTmpDir, getTaskTmpDir, FILES_DIR } from '../../utils/cleanup.js';
import { submitToQueue } from './queue.js';

// ─── SSE 客户端管理 ──────────────────────────────────────────────────────────
// Map<taskId, Set<Response>>：支持同一任务被多个客户端订阅（刷新页面场景）
const sseClients = new Map<string, Set<Response>>();

export function registerSseClient(taskId: string, res: Response): void {
  if (!sseClients.has(taskId)) {
    sseClients.set(taskId, new Set());
  }
  sseClients.get(taskId)!.add(res);
}

export function unregisterSseClient(taskId: string, res: Response): void {
  sseClients.get(taskId)?.delete(res);
  if (sseClients.get(taskId)?.size === 0) {
    sseClients.delete(taskId);
  }
}

/** 向指定任务的所有 SSE 客户端推送事件 */
function pushSSE(taskId: string, event: string, data: object): void {
  const clients = sseClients.get(taskId);
  if (!clients || clients.size === 0) return;

  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try {
      client.write(payload);
    } catch {
      // 客户端已断开，忽略写入错误
    }
  }
}

/** 关闭指定任务的所有 SSE 连接 */
function closeSSEClients(taskId: string): void {
  const clients = sseClients.get(taskId);
  if (!clients) return;
  for (const client of clients) {
    try {
      client.end();
    } catch {
      // 忽略
    }
  }
  sseClients.delete(taskId);
}

// ─── 转换任务核心流程 ─────────────────────────────────────────────────────────

/**
 * 提交 URL 转换任务
 * 1. 创建 task 记录
 * 2. 通过队列调度执行（全局 MAX_CONCURRENT，单用户 MAX_PER_USER）
 * 3. 立即返回 taskId（客户端随后连接 SSE 监听进度/排队状态）
 *
 * @throws 单用户并发超限时直接抛出，由 Controller 返回 429
 */
export async function submitUrlTask(params: {
  userId: number;
  url: string;
  format: OutputFormat;
}): Promise<string> {
  const taskId = uuidv4();

  createTask({
    id: taskId,
    user_id: params.userId,
    type: 'url',
    source: params.url,
    format: params.format,
  });

  submitToQueue({
    taskId,
    userId: params.userId,
    onQueued: () => {
      // 任务进入等待队列时，等待 SSE 客户端连接后推送排队状态
      // 使用短暂延迟给前端建立 SSE 连接的时间
      setTimeout(() => {
        pushSSE(taskId, 'queued', { message: '任务已排队，等待执行...' });
      }, 300);
    },
    run: async () => {
      const tmpDir = getTaskTmpDir(taskId);

      try {
        // 给前端约 200ms 建立 EventSource 连接
        await new Promise((r) => setTimeout(r, 200));

        // yt-dlp 下载（进度映射到 0~50%）
        const downloadedPath = await downloadWithYtdlp(
          params.url,
          taskId,
          (progress) => {
            pushSSE(taskId, 'progress', {
              percent: Math.floor(progress.percent / 2),
              stage: 'downloading',
            });
          },
        );

        // ffmpeg 转码（进度映射到 50~100%）
        const fileId = uuidv4();
        const outputPath = getFilePath(fileId, params.format);
        if (!fs.existsSync(FILES_DIR)) {
          fs.mkdirSync(FILES_DIR, { recursive: true });
        }

        updateTaskStatus(taskId, 'processing');

        await convertToAudio(
          downloadedPath,
          outputPath,
          params.format,
          (progress) => {
            pushSSE(taskId, 'progress', {
              percent: 50 + Math.floor(progress.percent / 2),
              stage: 'converting',
            });
          },
        );

        const [duration, stat] = await Promise.all([
          getAudioDuration(outputPath),
          Promise.resolve(fs.statSync(outputPath)),
        ]);

        createHistory({
          user_id: params.userId,
          task_id: taskId,
          file_id: fileId,
          original_name: params.url,
          format: params.format,
          file_size: stat.size,
          duration,
        });

        updateTaskStatus(taskId, 'done', fileId);
        pushSSE(taskId, 'done', { fileId });
        closeSSEClients(taskId);

      } catch (err) {
        const message = err instanceof Error ? err.message : '转换失败';
        updateTaskStatus(taskId, 'error', undefined, message);
        pushSSE(taskId, 'error', { message });
        closeSSEClients(taskId);
      } finally {
        cleanupTmpDir(tmpDir);
      }
    },
  });

  return taskId;
}

/**
 * 触发文件上传后的转码任务
 * inputPath 是分片合并后的完整视频文件路径
 *
 * @throws 单用户并发超限时直接抛出，由 Controller 返回 429
 */
export async function submitUploadTask(params: {
  userId: number;
  filename: string;
  inputPath: string;
  format: OutputFormat;
}): Promise<string> {
  const taskId = uuidv4();

  createTask({
    id: taskId,
    user_id: params.userId,
    type: 'upload',
    source: params.filename,
    format: params.format,
  });

  submitToQueue({
    taskId,
    userId: params.userId,
    onQueued: () => {
      setTimeout(() => {
        pushSSE(taskId, 'queued', { message: '任务已排队，等待执行...' });
      }, 300);
    },
    run: async () => {
      const { taskId: tid, userId, filename, inputPath, format } = {
        taskId,
        ...params,
      };
      const fileId = uuidv4();
      const outputPath = getFilePath(fileId, format);

      if (!fs.existsSync(FILES_DIR)) {
        fs.mkdirSync(FILES_DIR, { recursive: true });
      }

      try {
        updateTaskStatus(tid, 'processing');

        await convertToAudio(
          inputPath,
          outputPath,
          format,
          (progress) => {
            pushSSE(tid, 'progress', {
              percent: progress.percent,
              stage: 'converting',
            });
          },
        );

        const [duration, stat] = await Promise.all([
          getAudioDuration(outputPath),
          Promise.resolve(fs.statSync(outputPath)),
        ]);

        createHistory({
          user_id: userId,
          task_id: tid,
          file_id: fileId,
          original_name: filename,
          format,
          file_size: stat.size,
          duration,
        });

        updateTaskStatus(tid, 'done', fileId);
        pushSSE(tid, 'done', { fileId });
        closeSSEClients(tid);

      } catch (err) {
        const message = err instanceof Error ? err.message : '转换失败';
        updateTaskStatus(tid, 'error', undefined, message);
        pushSSE(tid, 'error', { message });
        closeSSEClients(tid);
      } finally {
        // 清理分片合并的临时文件
        cleanupTmpDir(path.dirname(inputPath));
      }
    },
  });

  return taskId;
}
