import { Router } from 'express';
import FileController from '../../controllers/file/index.js';

const router = Router();

// fileId 本身是 UUID（128 位随机），知道链接即可访问，无需额外鉴权（capability URL 模式）
router.get('/:fileId/preview', (req, res) => FileController.preview(req, res));
router.get('/:fileId/download', (req, res) => FileController.download(req, res));

export default router;
