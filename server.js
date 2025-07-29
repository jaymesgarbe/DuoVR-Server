const express = require('express');
const { Storage } = require('@google-cloud/storage');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const fileUpload = require('express-fileupload');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// File upload middleware with larger limits for video files
app.use(fileUpload({
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max file size for videos
  useTempFiles: true,
  tempFileDir: '/tmp/',
  createParentPath: true
}));

// Rate limiting - more lenient for video uploads
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50 // limit each IP to 50 requests per windowMs
});
app.use(limiter);

// Initialize Google Cloud Storage WITHOUT key file - uses service account attached to Cloud Run
const storage = new Storage({
  projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
});

console.log('🔐 Using Cloud Run service account for authentication');

// Initialize database only if DB_HOST is provided
let sequelize = null;
let FileMetadata = null;

if (process.env.DB_HOST && process.env.DB_HOST.trim() !== '' && process.env.DB_HOST !== 'your-db-host') {
  const { Sequelize } = require('sequelize');
  
  // Initialize Google Cloud SQL connection
  sequelize = new Sequelize({
    database: process.env.DB_NAME || 'duovr_db',
    username: process.env.DB_USER || 'duovr_user',
    password: process.env.DB_PASSWORD || 'secure_password',
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    dialect: 'postgres',
    dialectOptions: {
      socketPath: process.env.DB_SOCKET_PATH, // For Cloud SQL proxy
    },
    logging: console.log,
  });

  // Define the model
  FileMetadata = sequelize.define('FileMetadata', {
    id: {
      type: Sequelize.UUID,
      defaultValue: Sequelize.UUIDV4,
      primaryKey: true,
    },
    fileName: {
      type: Sequelize.STRING,
      allowNull: false,
    },
    bucketName: {
      type: Sequelize.STRING,
      allowNull: false,
    },
    filePath: {
      type: Sequelize.STRING,
      allowNull: false,
    },
    fileSize: {
      type: Sequelize.INTEGER,
    },
    mimeType: {
      type: Sequelize.STRING,
    },
    uploadedAt: {
      type: Sequelize.DATE,
      defaultValue: Sequelize.NOW,
    },
    userId: {
      type: Sequelize.STRING,
    },
  });
}

// Test database connection
async function testDatabaseConnection() {
  if (!sequelize) {
    console.log('⚠️ No database configured');
    return;
  }
  
  try {
    await sequelize.authenticate();
    console.log('✅ Database connection established successfully.');
  } catch (error) {
    console.error('❌ Unable to connect to the database:', error);
    throw error;
  }
}

// Cloud Storage helper functions
class CloudStorageService {
  constructor(bucketName) {
    this.bucketName = bucketName;
    this.bucket = storage.bucket(bucketName);
  }

  async uploadFile(file, destination) {
    try {
      console.log(`📤 Starting upload: ${file.name} -> ${destination}`);
      
      const blob = this.bucket.file(destination);
      const blobStream = blob.createWriteStream({
        metadata: {
          contentType: file.mimetype,
        },
        resumable: true, // Enable resumable uploads for large files
      });

      return new Promise((resolve, reject) => {
        blobStream.on('error', (error) => {
          console.error(`❌ Upload failed for ${destination}:`, error);
          reject(error);
        });
        
        blobStream.on('finish', async () => {
          console.log(`✅ Upload completed: ${destination}`);
          
          // Make the file publicly readable (optional)
          try {
            await blob.makePublic();
            console.log(`🌐 Made file public: ${destination}`);
          } catch (error) {
            console.log(`⚠️ Could not make file public: ${error.message}`);
          }
          
          resolve(`File ${destination} uploaded successfully`);
        });
        
        blobStream.end(file.data);
      });
    } catch (error) {
      console.error(`❌ Upload error for ${destination}:`, error);
      throw new Error(`Upload failed: ${error.message}`);
    }
  }

  async generateSignedUrl(fileName, options = {}) {
    try {
      const file = this.bucket.file(fileName);
      
      const signedUrlOptions = {
        version: 'v4',
        action: options.action || 'read',
        expires: Date.now() + (options.expiresInMinutes || 60) * 60 * 1000, // Default 1 hour
        ...options,
      };

      const [signedUrl] = await file.getSignedUrl(signedUrlOptions);
      return signedUrl;
    } catch (error) {
      throw new Error(`Failed to generate signed URL: ${error.message}`);
    }
  }

  async fileExists(fileName) {
    try {
      const [exists] = await this.bucket.file(fileName).exists();
      return exists;
    } catch (error) {
      throw new Error(`Failed to check file existence: ${error.message}`);
    }
  }

  async listFiles(prefix = '') {
    try {
      const [files] = await this.bucket.getFiles({ prefix });
      return files.map(file => ({
        name: file.name,
        size: file.metadata.size,
        updated: file.metadata.updated,
        contentType: file.metadata.contentType,
      }));
    } catch (error) {
      throw new Error(`Failed to list files: ${error.message}`);
    }
  }

  async deleteFile(fileName) {
    try {
      await this.bucket.file(fileName).delete();
      return `File ${fileName} deleted successfully`;
    } catch (error) {
      throw new Error(`Failed to delete file: ${error.message}`);
    }
  }
}

// Initialize storage service
const storageService = new CloudStorageService(process.env.GOOGLE_CLOUD_BUCKET_NAME || 'default-bucket');

// Utility functions
function isValidVideoFile(file) {
  const validTypes = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/avi'];
  return validTypes.includes(file.mimetype.toLowerCase());
}

function generateUniqueFileName(originalName) {
  const timestamp = Date.now();
  const randomStr = Math.random().toString(36).substring(2, 8);
  const extension = originalName.split('.').pop();
  const nameWithoutExt = originalName.replace(/\.[^/.]+$/, "");
  return `360-videos/${timestamp}-${randomStr}-${nameWithoutExt}.${extension}`;
}

// Routes

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    database: sequelize ? 'configured' : 'not configured',
    environment: process.env.NODE_ENV || 'development',
    authentication: 'using Cloud Run service account',
    bucket: process.env.GOOGLE_CLOUD_BUCKET_NAME || 'not configured'
  });
});

// Basic info endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'DuoVR Server is running!',
    timestamp: new Date().toISOString(),
    endpoints: [
      '/health',
      '/files/:fileName/signed-url',
      '/files/upload',
      '/files'
    ],
    database: sequelize ? 'available' : 'not configured',
    bucket: process.env.GOOGLE_CLOUD_BUCKET_NAME || 'not configured'
  });
});

// Upload file to bucket
app.post('/files/upload', async (req, res) => {
  try {
    console.log('📥 Upload request received');
    
    if (!req.files || !req.files.file) {
      console.log('❌ No file uploaded');
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const file = req.files.file;
    console.log(`📁 File details: ${file.name}, ${file.mimetype}, ${file.size} bytes`);

    // Validate file type
    if (!isValidVideoFile(file)) {
      console.log(`❌ Invalid file type: ${file.mimetype}`);
      return res.status(400).json({ 
        error: 'Invalid file type. Please upload video files only (MP4, MOV, AVI)' 
      });
    }

    // Check file size (max 500MB)
    const maxSize = 500 * 1024 * 1024; // 500MB
    if (file.size > maxSize) {
      console.log(`❌ File too large: ${file.size} bytes`);
      return res.status(400).json({ 
        error: 'File too large. Maximum size is 500MB' 
      });
    }

    // Generate unique file name
    const destination = generateUniqueFileName(file.name);
    console.log(`🎯 Upload destination: ${destination}`);

    // Upload to Google Cloud Storage
    await storageService.uploadFile(file, destination);

    // Save metadata to database if available
    let fileMetadata = null;
    if (FileMetadata) {
      try {
        fileMetadata = await FileMetadata.create({
          fileName: file.name,
          bucketName: process.env.GOOGLE_CLOUD_BUCKET_NAME,
          filePath: destination,
          fileSize: file.size,
          mimeType: file.mimetype,
          userId: req.user?.id || null,
        });
        console.log(`💾 Metadata saved to database: ${fileMetadata.id}`);
      } catch (dbError) {
        console.error('⚠️ Failed to save metadata to database:', dbError);
        // Continue anyway - file upload succeeded
      }
    }

    res.json({
      message: 'File uploaded successfully',
      file: {
        id: fileMetadata?.id || null,
        fileName: file.name,
        path: destination,
        size: file.size,
        mimeType: file.mimetype,
        bucketUrl: `gs://${process.env.GOOGLE_CLOUD_BUCKET_NAME}/${destination}`,
        uploadedAt: new Date().toISOString()
      }
    });

    console.log(`✅ Upload completed successfully: ${file.name}`);

  } catch (error) {
    console.error('❌ Error uploading file:', error);
    res.status(500).json({ 
      error: 'Upload failed: ' + error.message 
    });
  }
});

// Get signed URL for file access
app.get('/files/:fileName/signed-url', async (req, res) => {
  try {
    const { fileName } = req.params;
    const { expiresInMinutes = 60