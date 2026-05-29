import { Router } from 'express';
import FileController from '../../controllers/file/index.js';
import { fileAuthMiddleware } from '../../middleware/auth.js';

const router = Router();

// 文件接口使用 fileAuthMiddleware：支持 header 和 query token 两种方式
// query token 专为 <audio src> 原生流式播放场景设计，其他路由仍只接受 header token
router.use(fileAuthMiddleware);

router.get('/:fileId/preview', (req, res) => FileController.preview(req, res));
router.get('/:fileId/download', (req, res) => FileController.download(req, res));

export default router;
