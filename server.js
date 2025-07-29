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

// File upload middleware
app.use(fileUpload({
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max file size
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
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
}

// Initialize storage service
const storageService = new CloudStorageService(process.env.GOOGLE_CLOUD_BUCKET_NAME || 'default-bucket');

// Routes

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    database: sequelize ? 'configured' : 'not configured',
    environment: process.env.NODE_ENV || 'development',
    authentication: 'using Cloud Run service account'
  });
});

// Basic info endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'DuoVR Server is running!',
    timestamp: new Date().toISOString(),
    endpoints: ['/health', '/files/:fileName/signed-url'],
    database: sequelize ? 'available' : 'not configured',
    bucket: process.env.GOOGLE_CLOUD_BUCKET_NAME || 'not configured'
  });
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
    });
  } catch (error) {
    console.error('❌ Database connection failed, but starting server anyway:', error.message);
    
    // Start server without database
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 DuoVR Server running on port ${PORT} (database connection failed)`);
      console.log(`📱 Health check: http://localhost:${PORT}/health`);
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