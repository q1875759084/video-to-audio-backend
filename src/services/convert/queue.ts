/**
 * 转换任务队列
 *
 * 生产级并发控制策略：
 * - MAX_CONCURRENT：全局同时运行的任务上限
 *   每个任务在服务器上占用 1 个 yt-dlp + 1 个 ffmpeg 子进程（CPU 密集型），
 *   并发数超过 CPU 核数后只会让所有任务变慢，不会变快。
 *   当前服务器 2 核，Docker 限制 cpus: 1.5，设为 1 保证单任务独占核心，其他服务不被挤压。
 *   如果升级服务器核数，同步调整此值（建议 = 分配给本容器的核数 - 0.5 留给 Node.js）。
 *
 * - MAX_PER_USER：单用户「运行中 + 排队中」任务总数上限
 *   注意：这里统计的是「占用配额」的任务，包含排队中的，而不仅是运行中的。
 *   否则全局满载时，用户可以无限入队，全局一空载就同时涌入。
 *
 * - SSE 长连接 vs 进程并发：二者是独立的两层概念。
 *   SSE 连接在任务排队期间已建立，仅占用一条 TCP 通道，不占进程并发槽。
 *   HTTP/2 场景下所有 SSE 复用同一条 TCP，连接数不是瓶颈；
 *   HTTP/1.1 场景下批量任务会占满浏览器的每域名 6 条 TCP 限制，
 *   但这是浏览器限制而非服务器限制，此处不处理。
 *
 * 工作流：
 *   submit() → 检查用户配额（运行中 + 排队中）→ 立即执行 or 入队等待
 *   任务完成/失败 → next() 取队列头部执行
 */

interface QueueItem {
  taskId: string;
  userId: number;
  run: () => Promise<void>;    // 实际执行函数（yt-dlp + ffmpeg 流程）
  onQueued: () => void;        // 排队等待时通知前端
}

// 全局同时运行上限
// 2核服务器，Docker cpus 限制 1.5，设为 1：单任务独占可用算力，避免多任务互相 throttle
const MAX_CONCURRENT = 1;
// 单用户「运行中 + 排队中」任务总数上限
// 全局只有 1 个槽位，单用户上限设为 1，排队上限留给其他用户
const MAX_PER_USER = 1;

let running = 0;
const queue: QueueItem[] = [];

// 正在运行的任务（userId 与 taskId 同索引对应）
const activeUserIds: number[] = [];
const activeTaskIds: string[] = [];

/** 统计某用户当前正在运行的任务数 */
function countRunning(userId: number): number {
  return activeUserIds.filter((id) => id === userId).length;
}

/** 统计某用户在队列中等待的任务数 */
function countQueued(userId: number): number {
  return queue.filter((item) => item.userId === userId).length;
}

/**
 * 提交任务到队列
 *
 * @throws 该用户「运行中 + 排队中」总数已达上限时立即拒绝，不入队
 */
export function submitToQueue(item: QueueItem): void {
  // 统计运行中 + 排队中的总数，防止全局满载时无限入队绕过限制
  const userTotal = countRunning(item.userId) + countQueued(item.userId);
  if (userTotal >= MAX_PER_USER) {
    throw new Error(`您已有 ${MAX_PER_USER} 个任务正在进行或排队，请等待完成后再提交`);
  }

  if (running < MAX_CONCURRENT) {
    execute(item);
  } else {
    item.onQueued();
    queue.push(item);
  }
}

/** 立即执行一个任务 */
function execute(item: QueueItem): void {
  running++;
  activeUserIds.push(item.userId);
  activeTaskIds.push(item.taskId);

  item.run().finally(() => {
    running--;
    const idx = activeTaskIds.indexOf(item.taskId);
    if (idx !== -1) {
      activeUserIds.splice(idx, 1);
      activeTaskIds.splice(idx, 1);
    }
    next();
  });
}

/**
 * 获取某用户当前「运行中 + 排队中」的所有 taskId
 * 用于 429 响应时告知前端具体是哪些任务在占用配额
 */
export function getActiveTaskIds(userId: number): string[] {
  const runningIds = activeUserIds
    .map((uid, idx) => ({ uid, taskId: activeTaskIds[idx] }))
    .filter((item) => item.uid === userId)
    .map((item) => item.taskId);

  const queuedIds = queue
    .filter((item) => item.userId === userId)
    .map((item) => item.taskId);

  return [...runningIds, ...queuedIds];
}

/** 从队列取下一个可执行的任务 */
function next(): void {
  if (queue.length === 0 || running >= MAX_CONCURRENT) return;

  // 按顺序找第一个「用户运行中任务未超出单用户上限」的任务
  const idx = queue.findIndex((item) => countRunning(item.userId) < MAX_PER_USER);
  if (idx === -1) return;

  const [item] = queue.splice(idx, 1);
  execute(item);
}
