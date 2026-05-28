import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import type { Response } from 'express';
import { downloadWithYtdlp } from './ytdlp.js';
import { convertToAudio, getAudioDuration, type OutputFormat } from './ffmpeg.js';
import { createTask, updateTaskStatus } from '../../database/task/index.js';
import { createHistory } from '../../database/history/index.js';
import { getFilePath, cleanupTmpDir, getTaskTmpDir, FILES_DIR } from '../../utils/cleanup.js';

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

interface RunConvertOptions {
  taskId: string;
  userId: number;
  source: string;        // URL 或原始文件名
  inputPath: string;     // 已下载或已合并的输入文件路径
  format: OutputFormat;
  isUrlMode: boolean;    // true=URL模式（yt-dlp已下载），false=文件上传（直接输入）
}

/**
 * 执行转码主流程（URL 和文件上传模式共用）
 * 1. yt-dlp 下载（URL 模式）或直接使用上传文件
 * 2. ffmpeg 转码
 * 3. 写入历史记录
 * 4. SSE 推送完成事件
 */
async function runConvert(opts: RunConvertOptions): Promise<void> {
  const { taskId, userId, source, inputPath, format } = opts;
  const fileId = uuidv4();
  const outputPath = getFilePath(fileId, format);

  // 确保输出目录存在
  if (!fs.existsSync(FILES_DIR)) {
    fs.mkdirSync(FILES_DIR, { recursive: true });
  }

  try {
    updateTaskStatus(taskId, 'processing');

    // ─── 转码阶段（进度 0-100）──────────────────────────────────────
    await convertToAudio(
      inputPath,
      outputPath,
      format,
      (progress) => {
        pushSSE(taskId, 'progress', {
          percent: progress.percent,
          stage: 'converting',
        });
      },
    );

    // 获取音频时长和文件大小
    const [duration, stat] = await Promise.all([
      getAudioDuration(outputPath),
      Promise.resolve(fs.statSync(outputPath)),
    ]);

    // ─── 写入历史记录 ────────────────────────────────────────────────
    createHistory({
      user_id: userId,
      task_id: taskId,
      file_id: fileId,
      original_name: source,
      format,
      file_size: stat.size,
      duration,
    });

    updateTaskStatus(taskId, 'done', fileId);

    // 推送完成事件
    pushSSE(taskId, 'done', { fileId });
    closeSSEClients(taskId);

  } catch (err) {
    const message = err instanceof Error ? err.message : '转换失败';
    updateTaskStatus(taskId, 'error', undefined, message);
    pushSSE(taskId, 'error', { message });
    closeSSEClients(taskId);
  } finally {
    // 清理临时文件（yt-dlp 下载目录 或 分片合并临时文件）
    cleanupTmpDir(getTaskTmpDir(taskId));
  }
}

// ─── 对外暴露的入口 ──────────────────────────────────────────────────────────

/**
 * 提交 URL 转换任务
 * 1. 创建 task 记录
 * 2. 异步启动 yt-dlp 下载 + ffmpeg 转码
 * 3. 立即返回 taskId（客户端随后连接 SSE 监听进度）
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

  // 异步执行，不阻塞响应
  setImmediate(async () => {
    const tmpDir = getTaskTmpDir(taskId);

    try {
      // 先等待 SSE 客户端有机会连接（给前端约 200ms 建立 EventSource）
      await new Promise((r) => setTimeout(r, 200));

      // yt-dlp 下载（进度映射到 0-50%）
      const downloadedPath = await downloadWithYtdlp(
        params.url,
        taskId,
        (progress) => {
          // 下载进度占总进度 0~50%
          pushSSE(taskId, 'progress', {
            percent: Math.floor(progress.percent / 2),
            stage: 'downloading',
          });
        },
      );

      // ffmpeg 转码（进度映射到 50-100%）
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
  });

  return taskId;
}

/**
 * 触发文件上传后的转码任务
 * inputPath 是分片合并后的完整视频文件路径
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

  // 异步执行转码
  setImmediate(() => {
    runConvert({
      taskId,
      userId: params.userId,
      source: params.filename,
      inputPath: params.inputPath,
      format: params.format,
      isUrlMode: false,
    });
  });

  return taskId;
}
