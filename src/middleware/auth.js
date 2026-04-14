import { supabase } from '../supabase.js';

/**
 * Middleware to authenticate user using session token from cookies or Authorization header
 */
export const authenticateUser = async (req, res, next) => {
  try {
    // Try to get token from Authorization header first
    let token = req.headers.authorization?.replace('Bearer ', '');
    
    // If not in header, try to get from cookies
    if (!token && req.cookies) {
      token = req.cookies.access_token || req.cookies['sb-access-token'];
    }

    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Verify the token with Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Attach user to request object
    req.user = user;
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
};