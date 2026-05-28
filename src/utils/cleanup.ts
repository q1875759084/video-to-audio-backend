import fs from 'fs';
import path from 'path';

// 音频文件存储目录，生产通过 Docker Volume 挂载
export const FILES_DIR = process.env.FILES_DIR || path.resolve(process.cwd(), 'files');
// 临时文件目录：yt-dlp 下载 + 分片上传暂存
export const TMP_DIR = process.env.TMP_DIR || '/tmp/vta';

// 确保目录存在
if (!fs.existsSync(FILES_DIR)) fs.mkdirSync(FILES_DIR, { recursive: true });
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
if (!fs.existsSync(path.join(TMP_DIR, 'uploads'))) {
  fs.mkdirSync(path.join(TMP_DIR, 'uploads'), { recursive: true });
}

/** 获取音频文件完整路径 */
export function getFilePath(fileId: string, format: string): string {
  return path.join(FILES_DIR, `${fileId}.${format}`);
}

/** 删除音频文件（文件不存在时静默处理）*/
export function deleteFile(fileId: string, format: string): void {
  const filePath = getFilePath(fileId, format);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // 删除失败静默处理，不影响数据库操作
  }
}

/** 删除整个临时目录（任务完成后清理）*/
export function cleanupTmpDir(dirPath: string): void {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch {
    // 清理失败静默处理
  }
}

/** 获取分片上传的临时目录 */
export function getUploadTmpDir(uploadId: string): string {
  return path.join(TMP_DIR, 'uploads', uploadId);
}

/** 获取任务临时目录（yt-dlp 下载用）*/
export function getTaskTmpDir(taskId: string): string {
  return path.join(TMP_DIR, taskId);
}
