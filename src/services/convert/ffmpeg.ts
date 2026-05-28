import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';

export type OutputFormat = 'mp3' | 'aac' | 'wav';

export interface FfmpegProgress {
  percent: number;  // 0-100
}

// format 对应的 codec 和扩展名
const FORMAT_CONFIG: Record<OutputFormat, { codec: string; ext: string }> = {
  mp3:  { codec: 'libmp3lame', ext: 'mp3' },
  aac:  { codec: 'aac',        ext: 'aac' },
  wav:  { codec: 'pcm_s16le',  ext: 'wav' },
};

/**
 * 使用 ffmpeg 将视频/音频文件转换为目标音频格式
 *
 * @param inputPath   输入文件路径
 * @param outputPath  输出文件路径
 * @param format      输出格式
 * @param onProgress  进度回调（转码进度 0-100）
 */
export async function convertToAudio(
  inputPath: string,
  outputPath: string,
  format: OutputFormat,
  onProgress: (progress: FfmpegProgress) => void,
): Promise<void> {
  const config = FORMAT_CONFIG[format];

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .noVideo()                // 去掉视频流，只保留音频
      .audioCodec(config.codec)
      .audioQuality(2)          // VBR 质量 2（mp3 约 190kbps，音质优先）
      .on('progress', (progress) => {
        // fluent-ffmpeg progress.percent 有时为 undefined，需容错
        const percent = Math.min(100, Math.floor(progress.percent ?? 0));
        onProgress({ percent });
      })
      .on('end', () => {
        onProgress({ percent: 100 });
        resolve();
      })
      .on('error', (err) => {
        // 清理可能生成的残缺输出文件
        if (fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath);
        }
        reject(new Error(`ffmpeg 转码失败：${err.message}`));
      })
      .save(outputPath);
  });
}

/** 获取音频文件时长（秒）*/
export async function getAudioDuration(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (_err, metadata) => {
      // 出错或无法读取时返回 0，不影响主流程
      resolve(metadata?.format?.duration ?? 0);
    });
  });
}
