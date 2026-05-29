import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { getTaskTmpDir } from '../../utils/cleanup.js';

/**
 * 通过快代理 API 动态获取当前有效的独享代理地址。
 *
 * 独享代理（纯生版动态型）的 IP 每天自然失效后会自动分配新 IP，
 * 因此不能硬编码 IP，每次启动 yt-dlp 前先调 API 获取当前 IP。
 *
 * API 文档：https://www.kuaidaili.com/doc/api/getkpsbyid/
 * 鉴权方式：密钥明文验证（signature 直接填 SecretKey）
 */
async function getKdlProxy(): Promise<string> {
  const secretId = process.env.KDL_SECRET_ID ?? 'owjk4o8w9k62dibs8hfz';
  const signature = process.env.KDL_SIGNATURE ?? 'mgr1wjzfu3g8dmn3lnmnk1qjomrtfnno';
  const fId = process.env.KDL_F_ID ?? 'lrps-419156';
  const proxyUser = process.env.KDL_PROXY_USER ?? 'pmgqqvfy';
  const proxyPass = process.env.KDL_PROXY_PASS ?? 'wwrslolq';

  const url = `https://kps.kdlapi.com/api/getkpsbyid?secret_id=${secretId}&signature=${signature}&f_id=${fId}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`快代理 API 请求失败: ${res.status}`);

  const json = await res.json() as { code: number; msg: string; data: { ip: string; port: string } };
  if (json.code !== 0) throw new Error(`快代理 API 返回错误: ${json.msg}`);

  const { ip, port } = json.data;
  return `http://${proxyUser}:${proxyPass}@${ip}:${port}`;
}

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

  // 动态获取当前有效的代理地址（IP 每天自然失效后快代理自动换新 IP）
  const proxy = await getKdlProxy();

  return new Promise((resolve, reject) => {
    // yt-dlp 参数说明：
    // --no-playlist：只下载单个视频，不下载整个播放列表
    // -f bestaudio/best：优先下载最佳音频流，无音频则取最佳视频流（ffmpeg 后续提取音频）
    // --newline：每个进度更新单独一行，便于解析
    // --user-agent：伪装成真实浏览器，降低被平台识别为爬虫的风险
    // --add-header：补充 Accept-Language，模拟正常浏览器请求特征
    // --proxy：国内运营商原生 IP（快代理独享纯生版），绕过 B 站对云服务商数据中心 IP 的 412 拦截
    const args = [
      url,
      '-o', outputTemplate,
      '--no-playlist',
      '-f', 'bestaudio/best',
      '--newline',
      '--no-warnings',
      '--user-agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      '--add-header', 'Accept-Language:zh-CN,zh;q=0.9,en;q=0.8',
      '--proxy', proxy,
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
