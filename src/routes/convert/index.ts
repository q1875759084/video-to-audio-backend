import { Router } from 'express';
import ConvertController from '../../controllers/convert/index.js';
import { authMiddleware } from '../../middleware/auth.js';

const router = Router();

// 所有转换接口均需鉴权
router.use(authMiddleware);

router.post('/url', (req, res) => ConvertController.submitUrl(req, res));
router.post('/upload/init', (req, res) => ConvertController.initUpload(req, res));
// uploadChunk 是 middleware 数组，需展开
router.post('/upload/chunk', ...ConvertController.uploadChunk);
router.post('/upload/merge', (req, res) => ConvertController.mergeAndConvert(req, res));
router.get('/progress/:taskId', (req, res) => ConvertController.getProgress(req, res));

export default router;
