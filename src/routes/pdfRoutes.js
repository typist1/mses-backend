import express from 'express';
import pdfController from '../controllers/pdfController.js';
import authMiddleware from '../middleware/authMiddleware.js';

const router = express.Router();

router.post('/extractText', pdfController.upload.single("file"), pdfController.extractText);
router.post('/extractJobDescription', pdfController.extractJobDescription);
router.post('/convert-to-pdf', authMiddleware, pdfController.upload.single("file"), pdfController.convertToPdf);

export default router;