import express from 'express';

import authController from '../controllers/authController.js';

const router = express.Router();

router.post('/signup', authController.signup);
router.post('/login', authController.login);
router.post('/logout', authController.logout);
router.get('/me', authController.getMe);
router.post('/token', authController.handleToken);

export default router;
