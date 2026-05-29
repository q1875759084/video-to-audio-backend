import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';

export type OutputFormat = 'mp3' | 'aac' | 'wav';

export interface FfmpegProgress {
  percent: number;  // 0-100
}

// format 对应的编码配置
// audioBitrate: 显式指定码率，避免 ffmpeg 使用极低的默认值导致失真
//   mp3: 192kbps 是主流有损音乐发布标准，平衡音质与体积
//   aac: 192kbps，内置 aac 编码器默认仅 64~96kbps，不加此项会严重失真
//   wav: PCM 无损，无需码率，采样率 44100Hz 对齐 CD 标准
// audioQuality: 仅对 libmp3lame (mp3) 有效，值越小质量越高（0最高，9最低）
//   aac/wav 不设此项，避免传入无意义参数干扰 ffmpeg
const FORMAT_CONFIG: Record<OutputFormat, {
  codec: string;
  ext: string;
  audioBitrate?: string;
  audioQuality?: number;
  audioFrequency?: number;
}> = {
  mp3: { codec: 'libmp3lame', ext: 'mp3', audioQuality: 2 },
  aac: { codec: 'aac',        ext: 'aac', audioBitrate: '192k' },
  wav: { codec: 'pcm_s16le',  ext: 'wav', audioFrequency: 44100 },
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
    let cmd = ffmpeg(inputPath)
      .noVideo()                        // 去掉视频流，只保留音频
      .audioCodec(config.codec);

    // 按格式应用对应的编码参数（仅设置有意义的项，避免参数污染）
    if (config.audioQuality !== undefined) cmd = cmd.audioQuality(config.audioQuality);
    if (config.audioBitrate !== undefined) cmd = cmd.audioBitrate(config.audioBitrate);
    if (config.audioFrequency !== undefined) cmd = cmd.audioFrequency(config.audioFrequency);

    cmd
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
