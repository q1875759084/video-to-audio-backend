import { Router, Request, Response } from 'express';
import userRouter from './user/index.js';
import convertRouter from './convert/index.js';
import fileRouter from './file/index.js';
import historyRouter from './history/index.js';

const router = Router();

router.use('/user', userRouter);
router.use('/convert', convertRouter);
router.use('/file', fileRouter);
router.use('/history', historyRouter);

// 兜底路由
router.use((_req: Request, res: Response) => {
  res.status(404).json({
    code: 404,
    message: 'API 路径不存在',
    data: null,
  });
});

export default router;
