import { Router } from 'express';
import FileController from '../../controllers/file/index.js';
import { authMiddleware, fileDownloadAuthMiddleware } from '../../middleware/auth.js';

const router = Router();

// preview：仅支持 Authorization header（fetch + Blob URL 场景）
router.get('/:fileId/preview', authMiddleware, (req, res) => FileController.preview(req, res));
// download：支持 header 和 query token，允许浏览器原生下载（window.location.href）
router.get('/:fileId/download', fileDownloadAuthMiddleware, (req, res) => FileController.download(req, res));

export default router;
