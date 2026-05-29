import { Router } from 'express';
import FileController from '../../controllers/file/index.js';
import { authMiddleware } from '../../middleware/auth.js';

const router = Router();

router.use(authMiddleware);

router.get('/:fileId/preview', (req, res) => FileController.preview(req, res));
router.get('/:fileId/download', (req, res) => FileController.download(req, res));

export default router;
