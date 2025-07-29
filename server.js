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

// CORS configuration to allow GitHub Pages
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:8080',
    'https://jaymesgarbe.github.io',
    'file://' // Allow local file access
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// File upload middleware with large limits for video files
app.use(fileUpload({
  limits: { fileSize: 32 * 1024 * 1024 * 1024 }, // 32GB max file size for videos
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

// Generate signed upload URL for direct browser upload
app.post('/files/generate-upload-url', async (req, res) => {
  try {
    const { fileName, fileType, fileSize } = req.body;

    if (!fileName || !fileType) {
      return res.status(400).json({ error: 'fileName and fileType are required' });
    }

    // Validate file type
    const validTypes = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/avi'];
    if (!validTypes.includes(fileType.toLowerCase())) {
      return res.status(400).json({ 
        error: 'Invalid file type. Please upload video files only (MP4, MOV, AVI)' 
      });
    }

    // Check file size (max 4GB for direct uploads)
    const maxSize = 4 * 1024 * 1024 * 1024; // 4GB
    if (fileSize && fileSize > maxSize) {
      return res.status(400).json({ 
        error: 'File too large. Maximum size is 4GB for direct uploads' 
      });
    }

    // Generate unique file name
    const destination = generateUniqueFileName(fileName);
    console.log(`🎯 Generated upload destination: ${destination}`);

    // Generate signed upload URL
    const file = storageService.bucket.file(destination);
    const [signedUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + 60 * 60 * 1000, // 1 hour
      contentType: fileType,
      extensionHeaders: {
        'x-goog-content-length-range': '0,4294967296' // 0 to 4GB
      }
    });

    console.log(`✅ Generated signed upload URL for: ${destination}`);

    // Save metadata to database if available
    let fileMetadata = null;
    if (FileMetadata) {
      try {
        fileMetadata = await FileMetadata.create({
          fileName: fileName,
          bucketName: process.env.GOOGLE_CLOUD_BUCKET_NAME,
          filePath: destination,
          fileSize: fileSize || null,
          mimeType: fileType,
          userId: req.user?.id || null,
        });
        console.log(`💾 Pre-saved metadata to database: ${fileMetadata.id}`);
      } catch (dbError) {
        console.error('⚠️ Failed to save metadata to database:', dbError);
        // Continue anyway
      }
    }

    res.json({
      uploadUrl: signedUrl,
      destination: destination,
      fileId: fileMetadata?.id || null,
      expiresIn: '1 hour',
      maxSize: '4GB'
    });

  } catch (error) {
    console.error('❌ Error generating upload URL:', error);
    res.status(500).json({ 
      error: 'Failed to generate upload URL: ' + error.message 
    });
  }
});
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

    // Check file size (max 32GB)
    const maxSize = 32 * 1024 * 1024 * 1024; // 32GB
    if (file.size > maxSize) {
      console.log(`❌ File too large: ${file.size} bytes`);
      return res.status(400).json({ 
        error: 'File too large. Maximum size is 32GB' 
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
    const { expiresInMinutes = 60, action = 'read' } = req.query;

    console.log(`🔍 Checking if file exists: ${fileName} in bucket: ${process.env.GOOGLE_CLOUD_BUCKET_NAME}`);

    // Check if file exists
    const exists = await storageService.fileExists(fileName);
    if (!exists) {
      console.log(`❌ File not found: ${fileName}`);
      return res.status(404).json({ error: 'File not found' });
    }

    console.log(`✅ File found: ${fileName}, generating signed URL`);

    const signedUrl = await storageService.generateSignedUrl(fileName, {
      action,
      expiresInMinutes: parseInt(expiresInMinutes),
    });

    console.log(`✅ Signed URL generated successfully for: ${fileName}`);

    res.json({ 
      signedUrl,
      fileName,
      expiresIn: `${expiresInMinutes} minutes`,
      action
    });
  } catch (error) {
    console.error('❌ Error generating signed URL:', error);
    res.status(500).json({ error: error.message });
  }
});

// List files in bucket
app.get('/files', async (req, res) => {
  try {
    const { prefix } = req.query;
    const files = await storageService.listFiles(prefix);
    
    // Also get metadata from database if available
    let dbFiles = [];
    if (FileMetadata) {
      try {
        dbFiles = await FileMetadata.findAll({
          order: [['uploadedAt', 'DESC']],
        });
      } catch (dbError) {
        console.error('⚠️ Failed to fetch from database:', dbError);
      }
    }

    res.json({
      bucketFiles: files,
      databaseFiles: dbFiles,
      totalFiles: files.length
    });
  } catch (error) {
    console.error('Error listing files:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete file
app.delete('/files/:fileName', async (req, res) => {
  try {
    const { fileName } = req.params;

    await storageService.deleteFile(fileName);
    
    // Remove from database if available
    if (FileMetadata) {
      try {
        await FileMetadata.destroy({
          where: { fileName }
        });
      } catch (dbError) {
        console.error('⚠️ Failed to delete from database:', dbError);
      }
    }

    res.json({ message: `File ${fileName} deleted successfully` });
  } catch (error) {
    console.error('Error deleting file:', error);
    res.status(500).json({ error: error.message });
  }
});

// Database operations (only if database is configured)
app.get('/db/files', async (req, res) => {
  if (!FileMetadata) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  
  try {
    const files = await FileMetadata.findAll({
      order: [['uploadedAt', 'DESC']],
    });
    res.json(files);
  } catch (error) {
    console.error('Error fetching files from database:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get file metadata by ID
app.get('/db/files/:id', async (req, res) => {
  if (!FileMetadata) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  
  try {
    const file = await FileMetadata.findByPk(req.params.id);
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }
    res.json(file);
  } catch (error) {
    console.error('Error fetching file:', error);
    res.status(500).json({ error: error.message });
  }
});

// Bulk signed URL generation
app.post('/files/bulk-signed-urls', async (req, res) => {
  try {
    const { fileNames, expiresInMinutes = 60, action = 'read' } = req.body;

    if (!Array.isArray(fileNames)) {
      return res.status(400).json({ error: 'fileNames must be an array' });
    }

    const results = await Promise.allSettled(
      fileNames.map(async (fileName) => {
        const exists = await storageService.fileExists(fileName);
        if (!exists) {
          throw new Error(`File ${fileName} not found`);
        }
        
        const signedUrl = await storageService.generateSignedUrl(fileName, {
          action,
          expiresInMinutes: parseInt(expiresInMinutes),
        });
        
        return { fileName, signedUrl };
      })
    );

    const successful = results
      .filter(result => result.status === 'fulfilled')
      .map(result => result.value);
      
    const failed = results
      .filter(result => result.status === 'rejected')
      .map((result, index) => ({
        fileName: fileNames[index],
        error: result.reason.message
      }));

    res.json({
      successful,
      failed,
      summary: {
        total: fileNames.length,
        successful: successful.length,
        failed: failed.length
      }
    });
  } catch (error) {
    console.error('Error generating bulk signed URLs:', error);
    res.status(500).json({ error: error.message });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : undefined
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Start server
async function startServer() {
  try {
    // Only try database connection if properly configured
    if (sequelize) {
      console.log('🔍 Testing database connection...');
      await testDatabaseConnection();
      await sequelize.sync({ alter: true });
      console.log('📊 Database models synchronized');
    } else {
      console.log('⚠️ No database configured, running without database features');
    }
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 DuoVR Server running on port ${PORT}`);
      console.log(`📱 Health check: http://localhost:${PORT}/health`);
      console.log(`🪣 Using bucket: ${process.env.GOOGLE_CLOUD_BUCKET_NAME || 'not configured'}`);
      console.log(`📏 Max file size: 32GB`);
    });
  } catch (error) {
    console.error('❌ Database connection failed, but starting server anyway:', error.message);
    
    // Start server without database
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 DuoVR Server running on port ${PORT} (database connection failed)`);
      console.log(`📱 Health check: http://localhost:${PORT}/health`);
      console.log(`🪣 Using bucket: ${process.env.GOOGLE_CLOUD_BUCKET_NAME || 'not configured'}`);
      console.log(`📏 Max file size: 32GB`);
    });
  }
}

startServer();

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Received SIGINT, shutting down gracefully...');
  if (sequelize) await sequelize.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
  if (sequelize) await sequelize.close();
  process.exit(0);
});