const express = require('express');
const { Storage } = require('@google-cloud/storage');
const { Sequelize } = require('sequelize');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Initialize Google Cloud Storage
const storage = new Storage({
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS, // Path to service account key
  projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
});

// Initialize Google Cloud SQL connection
const sequelize = new Sequelize({
  database: process.env.DB_NAME,
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
  dialect: 'postgres', // or 'mysql' depending on your setup
  dialectOptions: {
    socketPath: process.env.DB_SOCKET_PATH, // For Cloud SQL proxy
  },
  logging: console.log,
});

// Test database connection
async function testDatabaseConnection() {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connection established successfully.');
  } catch (error) {
    console.error('❌ Unable to connect to the database:', error);
  }
}

// Example model for files metadata
const FileMetadata = sequelize.define('FileMetadata', {
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
    type: Sequelize.STRING, // Assuming you have user management
  },
});

// Cloud Storage helper functions
class CloudStorageService {
  constructor(bucketName) {
    this.bucketName = bucketName;
    this.bucket = storage.bucket(bucketName);
  }

  async uploadFile(file, destination) {
    try {
      const blob = this.bucket.file(destination);
      const blobStream = blob.createWriteStream({
        metadata: {
          contentType: file.mimetype,
        },
      });

      return new Promise((resolve, reject) => {
        blobStream.on('error', reject);
        blobStream.on('finish', () => {
          resolve(`File ${destination} uploaded successfully`);
        });
        blobStream.end(file.buffer);
      });
    } catch (error) {
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

  async fileExists(fileName) {
    try {
      const [exists] = await this.bucket.file(fileName).exists();
      return exists;
    } catch (error) {
      throw new Error(`Failed to check file existence: ${error.message}`);
    }
  }
}

// Initialize storage service
const storageService = new CloudStorageService(process.env.GOOGLE_CLOUD_BUCKET_NAME);

// Routes

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    version: '1.0.0' 
  });
});

// Get signed URL for file access
app.get('/files/:fileName/signed-url', async (req, res) => {
  try {
    const { fileName } = req.params;
    const { expiresInMinutes = 60, action = 'read' } = req.query;

    // Check if file exists
    const exists = await storageService.fileExists(fileName);
    if (!exists) {
      return res.status(404).json({ error: 'File not found' });
    }

    const signedUrl = await storageService.generateSignedUrl(fileName, {
      action,
      expiresInMinutes: parseInt(expiresInMinutes),
    });

    // Log access in database
    const fileRecord = await FileMetadata.findOne({ where: { fileName } });
    if (fileRecord) {
      // You could add access logging here
      console.log(`Signed URL generated for ${fileName} by user ${req.user?.id || 'anonymous'}`);
    }

    res.json({ 
      signedUrl,
      fileName,
      expiresIn: `${expiresInMinutes} minutes`,
      action
    });
  } catch (error) {
    console.error('Error generating signed URL:', error);
    res.status(500).json({ error: error.message });
  }
});

// Upload file to bucket
app.post('/files/upload', async (req, res) => {
  try {
    if (!req.files || !req.files.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const file = req.files.file;
    const destination = `uploads/${Date.now()}-${file.name}`;

    await storageService.uploadFile(file, destination);

    // Save metadata to database
    const fileMetadata = await FileMetadata.create({
      fileName: file.name,
      bucketName: process.env.GOOGLE_CLOUD_BUCKET_NAME,
      filePath: destination,
      fileSize: file.size,
      mimeType: file.mimetype,
      userId: req.user?.id || null,
    });

    res.json({
      message: 'File uploaded successfully',
      file: {
        id: fileMetadata.id,
        fileName: file.name,
        path: destination,
        size: file.size,
        mimeType: file.mimetype,
      }
    });
  } catch (error) {
    console.error('Error uploading file:', error);
    res.status(500).json({ error: error.message });
  }
});

// List files in bucket
app.get('/files', async (req, res) => {
  try {
    const { prefix } = req.query;
    const files = await storageService.listFiles(prefix);
    
    // Also get metadata from database
    const dbFiles = await FileMetadata.findAll({
      order: [['uploadedAt', 'DESC']],
    });

    res.json({
      bucketFiles: files,
      databaseFiles: dbFiles,
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
    
    // Remove from database
    await FileMetadata.destroy({
      where: { fileName }
    });

    res.json({ message: `File ${fileName} deleted successfully` });
  } catch (error) {
    console.error('Error deleting file:', error);
    res.status(500).json({ error: error.message });
  }
});

// Database operations
app.get('/db/files', async (req, res) => {
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
    // Test database connection
    await testDatabaseConnection();
    
    // Sync database models
    await sequelize.sync({ alter: true });
    console.log('📊 Database models synchronized');
    
    app.listen(PORT, () => {
      console.log(`🚀 DuoVR Server running on port ${PORT}`);
      console.log(`📱 Health check: http://localhost:${PORT}/health`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Received SIGINT, shutting down gracefully...');
  await sequelize.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
  await sequelize.close();
  process.exit(0);
});