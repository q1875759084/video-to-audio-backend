import { spawn, execFile } from 'child_process';
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
  const secretId = process.env.KDL_SECRET_ID ?? 'ordb31uhqm711vequbmm';
  const signature = process.env.KDL_SIGNATURE ?? 'glv6cjnsq7xym75vuj7nbm0dbbxlqi0l';
  const fId = process.env.KDL_F_ID ?? 'lrps-719161';
  const proxyUser = process.env.KDL_PROXY_USER ?? 'pmgqqvfy';
  const proxyPass = process.env.KDL_PROXY_PASS ?? 'wwrslolq';

  const url = `https://kps.kdlapi.com/api/getkpsbyid?secret_id=${secretId}&signature=${signature}&f_id=${fId}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`快代理 API 请求失败: ${res.status}`);

  const json = await res.json() as { code: number; msg: string; data: { ip: string; port: string } };
  if (json.code !== 0) throw new Error(`快代理 API 返回错误: ${json.msg}`);

  const { ip, port } = json.data;
  // 使用 socks5 协议：HTTP 代理不支持 HTTPS CONNECT 隧道（返回 503），
  // SOCKS5 工作在传输层，天然支持 HTTP/HTTPS，B 站等 HTTPS 网站必须用 socks5://
  return `socks5://${proxyUser}:${proxyPass}@${ip}:${port}`;
}

/**
 * 判断 URL 是否为需要代理解析的平台链接（B 站等），
 * 直链文件（mp4/webm 等）无需代理可直接下载。
 */
function needsProxyExtract(url: string): boolean {
  return /bilibili\.com|b23\.tv/i.test(url);
}

/**
 * 用 yt-dlp -g 通过代理仅获取直链（不下载数据），
 * 再用 wget 直连服务器下载，绕过代理带宽瓶颈。
 *
 * 背景：快代理独享代理带宽约 4 KB/s，直接 yt-dlp 下载极慢；
 * B 站 CDN 直链对来源 IP 无限制，直连腾讯云可跑满带宽。
 *
 * B 站直链有效期约 10 分钟，需获取后立即下载。
 */
async function downloadViaDirect(
  url: string,
  proxy: string,
  outputPath: string,
  onProgress: (progress: YtdlpProgress) => void,
): Promise<void> {
  // Step 1: 通过代理获取真实 CDN 直链（-g 只输出 URL，不下载）
  //
  // 代理协议选择：
  // - socks5://  → Python urllib 本地 DNS 解析后传 IP，代理 ACL 拒绝裸 IP 访问 → Errno 4
  // - socks5h:// → 代理服务器做 DNS 解析（等价 curl --socks5-hostname），可绕过 ACL 问题
  //   但 Python 的 socks5h 实现有时会超时，因此加大 socket_timeout
  // 将 socks5:// 替换为 socks5h://，让代理服务器解析域名而非本地解析
  const socks5hProxy = proxy.replace(/^socks5:\/\//, 'socks5h://');

  const directUrl = await new Promise<string>((resolve, reject) => {
    execFile('yt-dlp', [
      url,
      '-g',
      '--no-playlist',
      '-f', 'bestaudio/best',
      '--no-warnings',
      '--proxy', socks5hProxy,
      '--socket-timeout', '30',
      '--user-agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      '--add-header', 'Accept-Language:zh-CN,zh;q=0.9,en;q=0.8',
    // execFile timeout = 35s：比 socket-timeout(30s) 略长，给握手和重试留余量
    // -g 只获取直链，正常 <5s 完成，超时说明代理不可用，尽早失败释放并发槽位
    ], { timeout: 35000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`yt-dlp -g 失败: ${stderr || err.message}`));
        return;
      }
      // -g 输出可能有多行（视频+音频分离流），取第一行
      const link = stdout.trim().split('\n')[0];
      if (!link) {
        reject(new Error('yt-dlp -g 未返回直链'));
        return;
      }
      resolve(link);
    });
  });

  console.log('[ytdlp] 获取到直链，开始直连下载');

  // Step 2: 直连下载（不走代理），上报进度
  await new Promise<void>((resolve, reject) => {
    // wget 的进度格式：... 45% 1.23MB/s
    const proc = spawn('wget', [
      '-O', outputPath,
      '--no-verbose',
      '--show-progress',
      '--progress=dot:mega',
      directUrl,
    ]);

    proc.stderr.on('data', (data: Buffer) => {
      const text = data.toString();
      // 解析 wget 进度：  45%  12.34M  1.23MB/s  eta 20s
      const match = text.match(/(\d+)%/);
      if (match) {
        const percent = Math.min(100, parseInt(match[1], 10));
        onProgress({ percent });
      }
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`wget 退出码 ${code}，直连下载失败`));
      } else {
        resolve();
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`wget 启动失败: ${err.message}`));
    });
  });
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

  // B 站链接：两步走（代理获取直链 + 直连下载），避免代理带宽瓶颈（约 4 KB/s）
  // 其他链接：yt-dlp 直接下载（无需代理）
  if (needsProxyExtract(url)) {
    const proxy = await getKdlProxy();
    // B 站 bestaudio 通常为 m4a 格式，后续 ffmpeg 可直接处理
    const outputPath = path.join(tmpDir, 'source.m4a');
    await downloadViaDirect(url, proxy, outputPath, onProgress);

    // 确认文件已生成（wget -O 固定命名，直接返回）
    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
      throw new Error('直连下载完成但文件不存在或为空');
    }
    return outputPath;
  }

  return new Promise((resolve, reject) => {
    // yt-dlp 参数说明：
    // --no-playlist：只下载单个视频，不下载整个播放列表
    // -f bestaudio/best：优先下载最佳音频流，无音频则取最佳视频流（ffmpeg 后续提取音频）
    // --newline：每个进度更新单独一行，便于解析
    // --user-agent：伪装成真实浏览器，降低被平台识别为爬虫的风险
    // --add-header：补充 Accept-Language，模拟正常浏览器请求特征
    const args = [
      url,
      '-o', outputTemplate,
      '--no-playlist',
      '-f', 'bestaudio/best',
      '--newline',
      '--no-warnings',
      '--user-agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      '--add-header', 'Accept-Language:zh-CN,zh;q=0.9,en;q=0.8',
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
