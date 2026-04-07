import express from 'express';
import pdfController from '../controllers/pdfController.js';

const router = express.Router();

router.post('/extractText', pdfController.upload.single("file"), pdfController.extractText);
router.post('/extractJobDescription', pdfController.extractJobDescription);

export default router;