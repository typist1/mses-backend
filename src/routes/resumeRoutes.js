import express from 'express';
import multer from 'multer';
import { supabase } from '../../supabase.js';
import authMiddleware from '../middleware/authMiddleware.js';

const router = express.Router();

// Configure multer for file uploads (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF and DOCX files are allowed.'));
    }
  },
});

// GET /resumes - List all resumes for the authenticated user
router.get('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.uid;

    const { data: resumes, error } = await supabase
      .from('Resumes')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching resumes:', error);
      return res.status(500).json({ error: 'Failed to fetch resumes' });
    }

    res.json({ resumes });
  } catch (error) {
    console.error('Error in GET /resumes:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /resumes/upload - Upload a new resume
router.post('/upload', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    const userId = req.user.uid;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Generate unique file path
    const timestamp = Date.now();
    const fileExtension = file.originalname.split('.').pop();
    const fileName = `${timestamp}-${file.originalname}`;
    const filePath = `${userId}/${fileName}`;

    // Upload file to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('resumes')
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });

    if (uploadError) {
      console.error('Error uploading to storage:', uploadError);
      return res.status(500).json({ error: 'Failed to upload file to storage' });
    }

    // Create database record
    const { data: resume, error: dbError } = await supabase
      .from('resumes')
      .insert({
        user_id: userId,
        file_name: file.originalname,
        file_path: filePath,
        file_size: file.size,
        is_active: false,
      })
      .select()
      .single();

    if (dbError) {
      console.error('Error creating database record:', dbError);
      
      // Clean up uploaded file if database insert fails
      await supabase.storage.from('resumes').remove([filePath]);
      
      return res.status(500).json({ error: 'Failed to save resume information' });
    }

    res.status(201).json({ message: 'Resume uploaded successfully', resume });
  } catch (error) {
    console.error('Error in POST /resumes/upload:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// DELETE /resumes/:id - Delete a resume
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.uid;
    const resumeId = req.params.id;

    // Get resume info
    const { data: resume, error: fetchError } = await supabase
      .from('resumes')
      .select('*')
      .eq('id', resumeId)
      .eq('user_id', userId)
      .single();

    if (fetchError || !resume) {
      return res.status(404).json({ error: 'Resume not found' });
    }

    // Delete from storage
    const { error: storageError } = await supabase.storage
      .from('resumes')
      .remove([resume.file_path]);

    if (storageError) {
      console.error('Error deleting from storage:', storageError);
      // Continue with database deletion even if storage deletion fails
    }

    // Delete from database
    const { error: dbError } = await supabase
      .from('resumes')
      .delete()
      .eq('id', resumeId)
      .eq('user_id', userId);

    if (dbError) {
      console.error('Error deleting from database:', dbError);
      return res.status(500).json({ error: 'Failed to delete resume' });
    }

    res.json({ message: 'Resume deleted successfully' });
  } catch (error) {
    console.error('Error in DELETE /resumes/:id:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /resumes/:id/download - Download a resume
router.get('/:id/download', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.uid;
    const resumeId = req.params.id;

    // Get resume info
    const { data: resume, error: fetchError } = await supabase
      .from('resumes')
      .select('*')
      .eq('id', resumeId)
      .eq('user_id', userId)
      .single();

    if (fetchError || !resume) {
      return res.status(404).json({ error: 'Resume not found' });
    }

    // Get signed URL for download
    const { data: signedUrlData, error: urlError } = await supabase.storage
      .from('resumes')
      .createSignedUrl(resume.file_path, 60); // URL valid for 60 seconds

    if (urlError || !signedUrlData) {
      console.error('Error creating signed URL:', urlError);
      return res.status(500).json({ error: 'Failed to generate download link' });
    }

    // Fetch the file and stream it to the client
    const fileResponse = await fetch(signedUrlData.signedUrl);
    
    if (!fileResponse.ok) {
      return res.status(500).json({ error: 'Failed to fetch file' });
    }

    const buffer = await fileResponse.arrayBuffer();

    // Set appropriate headers
    res.setHeader('Content-Type', resume.file_name.endsWith('.pdf') 
      ? 'application/pdf' 
      : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${resume.file_name}"`);
    res.setHeader('Content-Length', buffer.byteLength);

    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error('Error in GET /resumes/:id/download:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /resumes/:id/active - Set a resume as active
router.put('/:id/active', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.uid;
    const resumeId = req.params.id;

    // Verify resume belongs to user
    const { data: resume, error: fetchError } = await supabase
      .from('resumes')
      .select('*')
      .eq('id', resumeId)
      .eq('user_id', userId)
      .single();

    if (fetchError || !resume) {
      return res.status(404).json({ error: 'Resume not found' });
    }

    // The database trigger will automatically set other resumes to inactive
    const { error: updateError } = await supabase
      .from('resumes')
      .update({ is_active: true })
      .eq('id', resumeId)
      .eq('user_id', userId);

    if (updateError) {
      console.error('Error setting active resume:', updateError);
      return res.status(500).json({ error: 'Failed to set active resume' });
    }

    res.json({ message: 'Resume set as active successfully' });
  } catch (error) {
    console.error('Error in PUT /resumes/:id/active:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;