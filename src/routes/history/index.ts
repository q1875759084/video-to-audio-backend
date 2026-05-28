import { Router } from 'express';
import HistoryController from '../../controllers/history/index.js';
import { authMiddleware } from '../../middleware/auth.js';

const router = Router();

router.use(authMiddleware);

router.get('/', (req, res) => HistoryController.getHistory(req, res));
router.delete('/:id', (req, res) => HistoryController.deleteHistory(req, res));

export default router;
