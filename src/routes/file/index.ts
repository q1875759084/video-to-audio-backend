import { Router } from 'express';
import FileController from '../../controllers/file/index.js';
import { authMiddleware } from '../../middleware/auth.js';

const router = Router();

// 文件接口需鉴权（token 可通过 URL query 传递，支持 EventSource 和 a 标签下载）
router.use(authMiddleware);

router.get('/:fileId/preview', (req, res) => FileController.preview(req, res));
router.get('/:fileId/download', (req, res) => FileController.download(req, res));

export default router;
