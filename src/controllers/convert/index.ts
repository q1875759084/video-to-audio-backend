import { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { submitUrlTask, submitUploadTask, registerSseClient, unregisterSseClient } from '../../services/convert/index.js';
import { success, fail } from '../../utils/response.js';
import { getUploadTmpDir } from '../../utils/cleanup.js';
import { getTask, getTasksByIds } from '../../database/task/index.js';
import { getActiveTaskIds } from '../../services/convert/queue.js';

// multer 配置：分片上传，单片最大 10MB
const chunkUpload = multer({
  limits: { fileSize: 10 * 1024 * 1024 },
  storage: multer.memoryStorage(), // 分片数据先读入内存，再手动写入磁盘
});

class ConvertController {
  /** POST /api/convert/url —— 提交 URL 转换任务 */
  async submitUrl(req: Request, res: Response) {
    try {
      const { url, format } = req.body;
      if (!url || !url.trim()) {
        return fail(res, 400, '请提供视频 URL');
      }
      if (!['mp3', 'aac', 'wav'].includes(format)) {
        return fail(res, 400, '不支持的输出格式，请选择 mp3/aac/wav');
      }

      const taskId = await submitUrlTask({
        userId: req.userId!,
        url: url.trim(),
        format,
      });

      success(res, { taskId }, '任务已提交');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '提交失败';
      if (msg.includes('已有')) {
        // 并发超限：带上该用户当前进行中的任务信息，便于前端展示「是什么任务在占用配额」
        const activeIds = getActiveTaskIds(req.userId!);
        const activeTasks = getTasksByIds(activeIds).map((t) => ({
          taskId: t.id,
          source: t.source,
          type: t.type,
          format: t.format,
          status: t.status,
        }));
        return res.json({ code: 429, message: msg, data: { activeTasks } });
      }
      fail(res, 500, msg);
    }
  }

  /** POST /api/convert/upload/init —— 初始化分片上传 */
  async initUpload(req: Request, res: Response) {
    try {
      const { filename, totalChunks, format } = req.body;
      if (!filename || !totalChunks || !format) {
        return fail(res, 400, '缺少必要参数');
      }
      if (!['mp3', 'aac', 'wav'].includes(format)) {
        return fail(res, 400, '不支持的输出格式');
      }

      const uploadId = uuidv4();
      const uploadDir = getUploadTmpDir(uploadId);
      fs.mkdirSync(uploadDir, { recursive: true });

      // 将 metadata 保存到临时目录（merge 时读取）
      fs.writeFileSync(
        path.join(uploadDir, 'meta.json'),
        JSON.stringify({ filename, totalChunks: Number(totalChunks), format }),
      );

      success(res, { uploadId }, '上传初始化成功');
    } catch (err: unknown) {
      fail(res, 500, err instanceof Error ? err.message : '初始化失败');
    }
  }

  /** POST /api/convert/upload/chunk —— 上传单个分片 */
  uploadChunk = [
    chunkUpload.single('chunk'),
    async (req: Request, res: Response) => {
      try {
        const { uploadId, chunkIndex } = req.body;
        if (!uploadId || chunkIndex === undefined || !req.file) {
          return fail(res, 400, '缺少必要参数或分片数据');
        }

        const uploadDir = getUploadTmpDir(uploadId);
        if (!fs.existsSync(uploadDir)) {
          return fail(res, 400, 'uploadId 无效或已过期');
        }

        // 分片写入：{chunkIndex}.part
        const chunkPath = path.join(uploadDir, `${Number(chunkIndex)}.part`);
        fs.writeFileSync(chunkPath, req.file.buffer);

        // 统计已收到的分片数
        const received = fs.readdirSync(uploadDir).filter((f) => f.endsWith('.part')).length;
        success(res, { received });
      } catch (err: unknown) {
        fail(res, 500, err instanceof Error ? err.message : '分片上传失败');
      }
    },
  ];

  /** POST /api/convert/upload/merge —— 合并分片，触发转码 */
  async mergeAndConvert(req: Request, res: Response) {
    try {
      const { uploadId } = req.body;
      if (!uploadId) {
        return fail(res, 400, '缺少 uploadId');
      }

      const uploadDir = getUploadTmpDir(uploadId);
      if (!fs.existsSync(uploadDir)) {
        return fail(res, 400, 'uploadId 无效或已过期');
      }

      // 读取 metadata
      const metaPath = path.join(uploadDir, 'meta.json');
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as {
        filename: string;
        totalChunks: number;
        format: string;
      };

      // 校验分片完整性
      const parts = fs.readdirSync(uploadDir).filter((f) => f.endsWith('.part'));
      if (parts.length !== meta.totalChunks) {
        return fail(res, 400, `分片不完整：期望 ${meta.totalChunks} 片，已收到 ${parts.length} 片`);
      }

      // 合并所有分片（按索引排序）
      const mergedPath = path.join(uploadDir, 'merged');
      const writeStream = fs.createWriteStream(mergedPath);

      for (let i = 0; i < meta.totalChunks; i++) {
        const chunkPath = path.join(uploadDir, `${i}.part`);
        const chunkData = fs.readFileSync(chunkPath);
        writeStream.write(chunkData);
      }

      await new Promise<void>((resolve, reject) => {
        writeStream.end((err?: Error | null) => (err ? reject(err) : resolve()));
      });

      // 提交转码任务
      const taskId = await submitUploadTask({
        userId: req.userId!,
        filename: meta.filename,
        inputPath: mergedPath,
        format: meta.format as 'mp3' | 'aac' | 'wav',
      });

      success(res, { taskId }, '合并完成，转码任务已提交');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '合并失败';
      if (msg.includes('已有')) {
        const activeIds = getActiveTaskIds(req.userId!);
        const activeTasks = getTasksByIds(activeIds).map((t) => ({
          taskId: t.id,
          source: t.source,
          type: t.type,
          format: t.format,
          status: t.status,
        }));
        return res.json({ code: 429, message: msg, data: { activeTasks } });
      }
      fail(res, 500, msg);
    }
  }

  /** GET /api/convert/progress/:taskId —— SSE 实时进度 */
  async getProgress(req: Request, res: Response) {
    const { taskId } = req.params;

    // 检查任务是否存在
    const task = getTask(taskId);
    if (!task) {
      return res.status(404).json({ code: 404, message: '任务不存在' });
    }

    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // 告知 Nginx 不缓冲
    res.flushHeaders();

    // 如果任务已完成/出错，立即推送最终状态
    if (task.status === 'done' && task.file_id) {
      res.write(`event: done\ndata: ${JSON.stringify({ fileId: task.file_id })}\n\n`);
      res.end();
      return;
    }
    if (task.status === 'error') {
      res.write(`event: error\ndata: ${JSON.stringify({ message: task.error_msg || '转换失败' })}\n\n`);
      res.end();
      return;
    }

    // 注册 SSE 客户端
    registerSseClient(taskId, res);

    // 客户端断开时取消注册
    req.on('close', () => {
      unregisterSseClient(taskId, res);
    });

    // 心跳：每 15s 发送一次注释，防止代理/防火墙断开长连接
    const heartbeat = setInterval(() => {
      try {
        res.write(': heartbeat\n\n');
      } catch {
        clearInterval(heartbeat);
      }
    }, 15000);

    req.on('close', () => {
      clearInterval(heartbeat);
    });
  }
}

export default new ConvertController();
