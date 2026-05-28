import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { getTaskTmpDir } from '../../utils/cleanup.js';

export interface YtdlpProgress {
  percent: number;  // 0-100
}

/**
 * 使用 yt-dlp 下载视频到临时目录
 *
 * yt-dlp 天然支持：
 * - 直链视频文件（mp4/webm/mov 等）
 * - 各大平台链接（B站、YouTube 等）
 *
 * @param url    视频 URL
 * @param taskId 任务 ID，用于隔离临时目录
 * @param onProgress  进度回调（下载进度 0-100）
 * @returns 下载完成的视频文件路径
 */
export async function downloadWithYtdlp(
  url: string,
  taskId: string,
  onProgress: (progress: YtdlpProgress) => void,
): Promise<string> {
  const tmpDir = getTaskTmpDir(taskId);
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  // 输出模板：统一命名为 source.%(ext)s
  const outputTemplate = path.join(tmpDir, 'source.%(ext)s');

  return new Promise((resolve, reject) => {
    // yt-dlp 参数说明：
    // --no-playlist：只下载单个视频，不下载整个播放列表
    // -f bestaudio/best：优先下载最佳音频流，无音频则取最佳视频流（ffmpeg 后续提取音频）
    // --newline：每个进度更新单独一行，便于解析
    const args = [
      url,
      '-o', outputTemplate,
      '--no-playlist',
      '-f', 'bestaudio/best',
      '--newline',
      '--no-warnings',
    ];

    const proc = spawn('yt-dlp', args);
    let lastPercent = 0;

    proc.stdout.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        // 解析进度行：[download]  45.3% of ~50.00MiB at  1.23MiB/s ETA 00:20
        const match = line.match(/\[download\]\s+([\d.]+)%/);
        if (match) {
          const percent = Math.min(100, Math.floor(parseFloat(match[1])));
          if (percent > lastPercent) {
            lastPercent = percent;
            onProgress({ percent });
          }
        }
      }
    });

    proc.stderr.on('data', (data: Buffer) => {
      // yt-dlp 将很多信息输出到 stderr，不视为错误，仅记录日志
      console.log('[yt-dlp stderr]', data.toString().trim());
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`yt-dlp 退出码 ${code}，下载失败`));
        return;
      }

      // 查找下载的文件（扩展名不固定）
      const files = fs.readdirSync(tmpDir).filter((f) => f.startsWith('source.'));
      if (files.length === 0) {
        reject(new Error('yt-dlp 下载完成但未找到输出文件'));
        return;
      }

      resolve(path.join(tmpDir, files[0]));
    });

    proc.on('error', (err) => {
      reject(new Error(`yt-dlp 启动失败：${err.message}，请确认 yt-dlp 已安装`));
    });
  });
}
