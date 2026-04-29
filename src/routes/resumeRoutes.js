import express from 'express';
import multer from 'multer';
import mammoth from 'mammoth';
import { extractText as extractPDFText } from 'unpdf';
import { supabase } from '../../supabase.js';
import authMiddleware from '../middleware/authMiddleware.js';
import { parseResume, truncateInputs } from '../services/llmService.js';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 40 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF and DOCX files are allowed.'));
    }
  },
});

// Look up the Supabase users.id from a Firebase UID
async function getSupabaseUserId(firebaseUid) {
  const { data, error } = await supabase
    .from('users')
    .select('id')
    .eq('firebase_uid', firebaseUid)
    .single();
  if (error || !data) throw new Error('User not found in database');
  return data.id;
}

// GET /resumes - list all resumes for the authenticated user
router.get('/', authMiddleware, async (req, res) => {
  try {
    const userId = await getSupabaseUserId(req.user.uid);

    const { data: resumes, error } = await supabase
      .from('resumes')
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
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// POST /resumes/upload - upload a new resume
router.post('/upload', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    const userId = await getSupabaseUserId(req.user.uid);
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const timestamp = Date.now();
    const fileName = `${timestamp}-${file.originalname}`;
    const filePath = `${userId}/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('Resumes')
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });

    if (uploadError) {
      console.error('Error uploading to storage:', JSON.stringify(uploadError));
      return res.status(500).json({ error: 'Failed to upload file to storage', detail: uploadError.message });
    }

    // Validate parentResumeId if provided
    const parentResumeId = req.body.parentResumeId ? parseInt(req.body.parentResumeId, 10) : null;
    if (parentResumeId) {
      const { data: parentRow } = await supabase
        .from('resumes')
        .select('id, file_name')
        .eq('id', parentResumeId)
        .eq('user_id', userId)
        .single();
      if (!parentRow) {
        await supabase.storage.from('Resumes').remove([filePath]);
        return res.status(400).json({ error: 'Invalid parentResumeId' });
      }
      // Auto-increment version label
      const { count } = await supabase
        .from('resumes')
        .select('*', { count: 'exact', head: true })
        .eq('parent_resume_id', parentResumeId);
      req._versionLabel = `v${(count || 0) + 2}`;
    }

    const { data: resume, error: dbError } = await supabase
      .from('resumes')
      .insert({
        user_id: userId,
        file_name: file.originalname,
        file_path: filePath,
        file_size: file.size,
        is_active: false,
        parent_resume_id: parentResumeId,
        version_label: parentResumeId ? req._versionLabel : null,
      })
      .select()
      .single();

    if (dbError) {
      console.error('Error creating database record:', dbError);
      await supabase.storage.from('Resumes').remove([filePath]);
      return res.status(500).json({ error: 'Failed to save resume information' });
    }

    res.status(201).json({ message: 'Resume uploaded successfully', resume });
  } catch (error) {
    console.error('Error in POST /resumes/upload:', error);
    res.status(500).json({ error: error.message || 'Internal server error', detail: error.message });
  }
});

// DELETE /resumes/:id - delete a resume
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const userId = await getSupabaseUserId(req.user.uid);
    const resumeId = req.params.id;

    const { data: resume, error: fetchError } = await supabase
      .from('resumes')
      .select('*')
      .eq('id', resumeId)
      .eq('user_id', userId)
      .single();

    if (fetchError || !resume) {
      return res.status(404).json({ error: 'Resume not found' });
    }

    const { error: storageError } = await supabase.storage
      .from('Resumes')
      .remove([resume.file_path]);

    if (storageError) {
      console.error('Error deleting from storage:', storageError);
    }

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
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// GET /resumes/:id/download - download a resume
router.get('/:id/download', authMiddleware, async (req, res) => {
  try {
    const userId = await getSupabaseUserId(req.user.uid);
    const resumeId = req.params.id;

    const { data: resume, error: fetchError } = await supabase
      .from('resumes')
      .select('*')
      .eq('id', resumeId)
      .eq('user_id', userId)
      .single();

    if (fetchError || !resume) {
      return res.status(404).json({ error: 'Resume not found' });
    }

    const { data: signedUrlData, error: urlError } = await supabase.storage
      .from('Resumes')
      .createSignedUrl(resume.file_path, 60);

    if (urlError || !signedUrlData) {
      console.error('Error creating signed URL:', urlError);
      return res.status(500).json({ error: 'Failed to generate download link' });
    }

    const fileResponse = await fetch(signedUrlData.signedUrl);
    if (!fileResponse.ok) {
      return res.status(500).json({ error: 'Failed to fetch file' });
    }

    const buffer = await fileResponse.arrayBuffer();

    res.setHeader(
      'Content-Type',
      resume.file_name.endsWith('.pdf')
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${resume.file_name}"`);
    res.setHeader('Content-Length', buffer.byteLength);
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error('Error in GET /resumes/:id/download:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// PUT /resumes/:id/active - set a resume as active (deactivates all others)
router.put('/:id/active', authMiddleware, async (req, res) => {
  try {
    const userId = await getSupabaseUserId(req.user.uid);
    const resumeId = req.params.id;

    // Verify resume belongs to user
    const { data: resume, error: fetchError } = await supabase
      .from('resumes')
      .select('id')
      .eq('id', resumeId)
      .eq('user_id', userId)
      .single();

    if (fetchError || !resume) {
      return res.status(404).json({ error: 'Resume not found' });
    }

    // Deactivate all resumes for this user
    const { error: deactivateError } = await supabase
      .from('resumes')
      .update({ is_active: false })
      .eq('user_id', userId);

    if (deactivateError) {
      console.error('Error deactivating resumes:', deactivateError);
      return res.status(500).json({ error: 'Failed to update active resume' });
    }

    // Set the target as active
    const { error: activateError } = await supabase
      .from('resumes')
      .update({ is_active: true })
      .eq('id', resumeId)
      .eq('user_id', userId);

    if (activateError) {
      console.error('Error activating resume:', activateError);
      return res.status(500).json({ error: 'Failed to set active resume' });
    }

    res.json({ message: 'Resume set as active successfully' });
  } catch (error) {
    console.error('Error in PUT /resumes/:id/active:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// POST /resumes/:id/parse - parse (or return cached) parsed_resume JSON
router.post('/:id/parse', authMiddleware, async (req, res) => {
  try {
    const userId = await getSupabaseUserId(req.user.uid);
    const resumeId = req.params.id;

    const { data: resume, error: fetchError } = await supabase
      .from('resumes')
      .select('*')
      .eq('id', resumeId)
      .eq('user_id', userId)
      .single();

    if (fetchError || !resume) {
      return res.status(404).json({ error: 'Resume not found' });
    }

    if (resume.parsed_resume) {
      return res.json({ parsed_resume: resume.parsed_resume });
    }

    // Download file from Supabase storage
    const { data: fileBlob, error: dlError } = await supabase.storage
      .from('Resumes')
      .download(resume.file_path);

    if (dlError || !fileBlob) {
      return res.status(500).json({ error: 'Failed to download resume file' });
    }

    const buffer = Buffer.from(await fileBlob.arrayBuffer());

    let text = '';
    if (resume.file_name.endsWith('.pdf')) {
      const uint8Array = new Uint8Array(buffer);
      const { text: pdfText } = await extractPDFText(uint8Array, { mergePages: true });
      text = pdfText;
    } else {
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;
    }

    if (text.trim().length < 200) {
      return res.status(400).json({ error: 'Could not extract enough text from this resume' });
    }

    const { resumeText } = truncateInputs(text, '');
    const parsedResume = await parseResume(resumeText);

    await supabase.from('resumes').update({ parsed_resume: parsedResume }).eq('id', resumeId);

    return res.json({ parsed_resume: parsedResume });
  } catch (error) {
    console.error('Error in POST /resumes/:id/parse:', error);
    return res.status(500).json({ error: error.message || 'Failed to parse resume' });
  }
});

export default router;
