import { Router } from 'express';
import UserController from '../../controllers/user/index.js';
import { authMiddleware } from '../../middleware/auth.js';

const router = Router();

router.post('/login', (req, res) => UserController.login(req, res));
router.post('/logout', (req, res) => UserController.logout(req, res));
router.post('/refresh', (req, res) => UserController.refresh(req, res));
router.get('/profile', authMiddleware, (req, res) => UserController.getProfile(req, res));

export default router;
