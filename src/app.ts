import 'dotenv/config';
import express, { Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { initUserTable, seedPresetUsers } from './database/user/index.js';
import { initTaskTable } from './database/task/index.js';
import { initHistoryTable } from './database/history/index.js';
import routes from './routes/index.js';

// ─── 数据库初始化（启动时执行，幂等）────────────────────────────────────────
initUserTable();
initTaskTable();
initHistoryTable();
// 写入硬编码的预设账号（账号已存在则跳过）
seedPresetUsers();

const app = express();
const port = Number(process.env.PORT) || 3000;

// CORS 白名单（多域名逗号分隔）
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
  : [];

app.use(cors({
  origin: corsOrigins,
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
}));
app.use(cookieParser());
app.use(express.json());

// 注册所有路由，统一前缀 /api
app.use('/api', routes);

// 兜底
app.get('/', (_req: Request, res: Response) => {
  res.send(new Date().toISOString());
});

app.listen(port, () => {
  console.log(`✅ video-to-audio-backend running at http://localhost:${port}`);
});
