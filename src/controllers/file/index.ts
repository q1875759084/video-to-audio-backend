import { Request, Response } from 'express';
import fs from 'fs';
import { getFilePath } from '../../utils/cleanup.js';
import { fail } from '../../utils/response.js';

class FileController {
  /**
   * GET /api/file/:fileId/preview —— 流式返回音频，支持 Range 请求
   *
   * Range 请求支持说明：
   * HTML5 <audio> 元素在播放时会发起 Range 请求（如拖动进度条）
   * 后端必须正确响应 206 Partial Content，否则无法拖动
   */
  async preview(req: Request, res: Response) {
    const { fileId } = req.params;

    const format = this.resolveFormat(fileId);
    if (!format) {
      return fail(res, 404, '文件不存在');
    }

    const filePath = getFilePath(fileId, format);
    if (!fs.existsSync(filePath)) {
      return fail(res, 404, '文件已被删除');
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    const mimeTypes: Record<string, string> = {
      mp3: 'audio/mpeg',
      aac: 'audio/aac',
      wav: 'audio/wav',
    };
    const contentType = mimeTypes[format] || 'audio/mpeg';

    if (range) {
      // 解析 Range: bytes=start-end
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType,
      });

      const readStream = fs.createReadStream(filePath, { start, end });
      readStream.pipe(res);
    } else {
      // 无 Range：返回完整文件
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
      });
      fs.createReadStream(filePath).pipe(res);
    }
  }

  /**
   * GET /api/file/:fileId/download —— 触发浏览器下载
   */
  async download(req: Request, res: Response) {
    const { fileId } = req.params;

    const format = this.resolveFormat(fileId);
    if (!format) {
      return fail(res, 404, '文件不存在');
    }

    const filePath = getFilePath(fileId, format);
    if (!fs.existsSync(filePath)) {
      return fail(res, 404, '文件已被删除');
    }

    const filename = (req.query.filename as string | undefined)
      || `audio_${fileId.slice(0, 8)}.${format}`;

    const mimeTypes: Record<string, string> = {
      mp3: 'audio/mpeg',
      aac: 'audio/aac',
      wav: 'audio/wav',
    };
    const contentType = mimeTypes[format] || 'application/octet-stream';
    const stat = fs.statSync(filePath);

    // filename* 使用 RFC 5987 编码，确保中文/特殊字符文件名在各端正确显示
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', stat.size);

    fs.createReadStream(filePath).pipe(res);
  }

  /** 通过 fileId 查找对应的格式（文件名格式：{fileId}.{format}） */
  private resolveFormat(fileId: string): string | null {
    const formats = ['mp3', 'aac', 'wav'];
    for (const fmt of formats) {
      if (fs.existsSync(getFilePath(fileId, fmt))) {
        return fmt;
      }
    }
    return null;
  }
}

export default new FileController();
