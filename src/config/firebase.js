import dotenv from 'dotenv';
import admin from 'firebase-admin';

dotenv.config();

try {
  const serviceAccount = JSON.parse(
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY || '{}'
  );

  if (!serviceAccount.project_id) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_KEY environment variable is not properly configured'
    );
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  if (process.env.NODE_ENV !== 'production') console.log('Firebase Admin SDK initialized successfully');
} catch (error) {
  console.error('Error initializing Firebase Admin SDK:', error.message);
  throw error;
}

export default admin;
