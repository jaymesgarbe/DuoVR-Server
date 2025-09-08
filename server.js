const express = require('express');
const { Storage } = require('@google-cloud/storage');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const fileUpload = require('express-fileupload');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const { Sequelize, DataTypes } = require('sequelize');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Enhanced middleware
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      mediaSrc: ["'self'", "blob:", "https:"],
    },
  },
}));

// Enhanced CORS configuration
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:8080',
    'http://localhost:3001',
    'https://jaymesgarbe.github.io',
    'file://', // Allow local file access
    /^https:\/\/.*\.run\.app$/, // Allow other Cloud Run services
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Range', 'Accept-Ranges']
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Enhanced file upload middleware
app.use(fileUpload({
  limits: { fileSize: 8 * 1024 * 1024 * 1024 }, // 8GB max file size
  useTempFiles: true,
  tempFileDir: '/tmp/',
  createParentPath: true,
  abortOnLimit: false,
  responseOnLimit: "File size limit exceeded",
  uploadTimeout: 3600000, // 1 hour timeout
}));

// Enhanced rate limiting with different tiers
const createRateLimit = (windowMs, max, message) => rateLimit({
  windowMs,
  max,
  message: { error: message },
  standardHeaders: true,
  legacyHeaders: false,
});

// Different rate limits for different endpoints
const generalLimiter = createRateLimit(15 * 60 * 1000, 100, 'Too many requests');
const uploadLimiter = createRateLimit(60 * 60 * 1000, 10, 'Too many upload requests');
const streamLimiter = createRateLimit(60 * 1000, 30, 'Too many streaming requests');

app.use('/files/upload', uploadLimiter);
app.use('/files/stream', streamLimiter);
app.use(generalLimiter);

// Initialize Google Cloud Storage
const storage = new Storage({
  projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
});

console.log('🔐 Using Cloud Run service account for authentication');

// Enhanced database models
let sequelize = null;
let FileMetadata = null;
let VideoAnalytics = null;
let TranscodingJob = null;
let UserSession = null;

if (process.env.DB_HOST && process.env.DB_HOST.trim() !== '' && process.env.DB_HOST !== 'your-db-host') {
  sequelize = new Sequelize({
    database: process.env.DB_NAME || 'duovr_db',
    username: process.env.DB_USER || 'duovr_user',
    password: process.env.DB_PASSWORD || 'secure_password',
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    dialect: 'postgres',
    dialectOptions: {
      socketPath: process.env.DB_SOCKET_PATH,
    },
    logging: process.env.NODE_ENV === 'development' ? console.log : false,
    pool: {
      max: 5,
      min: 0,
      acquire: 30000,
      idle: 10000
    }
  });

  // Enhanced File Metadata Model
  FileMetadata = sequelize.define('FileMetadata', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    fileName: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    originalFileName: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    bucketName: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    filePath: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    fileSize: {
      type: DataTypes.BIGINT,
    },
    mimeType: {
      type: DataTypes.STRING,
    },
    duration: {
      type: DataTypes.FLOAT, // Video duration in seconds
    },
    resolution: {
      type: DataTypes.STRING, // e.g., "3840x1920"
    },
    frameRate: {
      type: DataTypes.FLOAT,
    },
    bitrate: {
      type: DataTypes.INTEGER,
    },
    codec: {
      type: DataTypes.STRING,
    },
    is360Video: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    projection: {
      type: DataTypes.ENUM('equirectangular', 'cubemap', 'fisheye'),
      allowNull: true,
    },
    thumbnailPath: {
      type: DataTypes.STRING,
    },
    previewPath: {
      type: DataTypes.STRING,
    },
    qualityLevels: {
      type: DataTypes.JSON, // Store available quality levels
      defaultValue: [],
    },
    uploadedAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
    userId: {
      type: DataTypes.STRING,
    },
    tags: {
      type: DataTypes.ARRAY(DataTypes.STRING),
      defaultValue: [],
    },
    isProcessed: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    processingStatus: {
      type: DataTypes.ENUM('pending', 'processing', 'completed', 'failed'),
      defaultValue: 'pending',
    },
    viewCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    lastViewed: {
      type: DataTypes.DATE,
    },
  });

  // Video Analytics Model
  VideoAnalytics = sequelize.define('VideoAnalytics', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    fileId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: FileMetadata,
        key: 'id'
      }
    },
    sessionId: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    userId: {
      type: DataTypes.STRING,
    },
    eventType: {
      type: DataTypes.ENUM('view_start', 'view_end', 'pause', 'resume', 'seek', 'quality_change', 'error'),
      allowNull: false,
    },
    timestamp: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
    videoTime: {
      type: DataTypes.FLOAT, // Current video playback time
    },
    quality: {
      type: DataTypes.STRING, // Quality level during event
    },
    metadata: {
      type: DataTypes.JSON, // Additional event data
      defaultValue: {},
    },
    userAgent: {
      type: DataTypes.STRING,
    },
    ipAddress: {
      type: DataTypes.STRING,
    },
  });

  // Transcoding Job Model
  TranscodingJob = sequelize.define('TranscodingJob', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    fileId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: FileMetadata,
        key: 'id'
      }
    },
    status: {
      type: DataTypes.ENUM('queued', 'processing', 'completed', 'failed'),
      defaultValue: 'queued',
    },
    targetQuality: {
      type: DataTypes.STRING, // e.g., '1080p', '720p', '480p'
    },
    outputPath: {
      type: DataTypes.STRING,
    },
    progress: {
      type: DataTypes.FLOAT,
      defaultValue: 0,
    },
    errorMessage: {
      type: DataTypes.TEXT,
    },
    startedAt: {
      type: DataTypes.DATE,
    },
    completedAt: {
      type: DataTypes.DATE,
    },
    estimatedDuration: {
      type: DataTypes.INTEGER, // in seconds
    },
  });

  // User Session Model
  UserSession = sequelize.define('UserSession', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    sessionId: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    userId: {
      type: DataTypes.STRING,
    },
    deviceType: {
      type: DataTypes.STRING, // 'vr', 'mobile', 'desktop'
    },
    platform: {
      type: DataTypes.STRING, // 'unity', 'web', 'oculus'
    },
    startTime: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
    lastActivity: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
  });

  // Set up associations
  FileMetadata.hasMany(VideoAnalytics, { foreignKey: 'fileId' });
  VideoAnalytics.belongsTo(FileMetadata, { foreignKey: 'fileId' });
  
  FileMetadata.hasMany(TranscodingJob, { foreignKey: 'fileId' });
  TranscodingJob.belongsTo(FileMetadata, { foreignKey: 'fileId' });
}

// Enhanced Cloud Storage Service
class CloudStorageService {
  constructor(bucketName) {
    this.bucketName = bucketName;
    this.bucket = storage.bucket(bucketName);
  }

  async uploadFile(file, destination, metadata = {}) {
    try {
      console.log(`📤 Starting upload: ${file.name} -> ${destination}`);
      
      const blob = this.bucket.file(destination);
      const blobStream = blob.createWriteStream({
        metadata: {
          contentType: file.mimetype,
          ...metadata,
        },
        resumable: true,
        chunkSize: 32 * 1024 * 1024, // 32MB chunks for large files
      });

      return new Promise((resolve, reject) => {
        blobStream.on('error', (error) => {
          console.error(`❌ Upload failed for ${destination}:`, error);
          reject(error);
        });
        
        blobStream.on('finish', async () => {
          console.log(`✅ Upload completed: ${destination}`);
          
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
        expires: Date.now() + (options.expiresInMinutes || 60) * 60 * 1000,
        ...options,
      };

      const [signedUrl] = await file.getSignedUrl(signedUrlOptions);
      return signedUrl;
    } catch (error) {
      throw new Error(`Failed to generate signed URL: ${error.message}`);
    }
  }

  async getFileMetadata(fileName) {
    try {
      const file = this.bucket.file(fileName);
      const [metadata] = await file.getMetadata();
      return metadata;
    } catch (error) {
      throw new Error(`Failed to get file metadata: ${error.message}`);
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

  async listFiles(prefix = '', options = {}) {
    try {
      const [files] = await this.bucket.getFiles({ 
        prefix,
        maxResults: options.limit || 100,
        pageToken: options.pageToken,
      });
      return files.map(file => ({
        name: file.name,
        size: parseInt(file.metadata.size),
        updated: file.metadata.updated,
        contentType: file.metadata.contentType,
        etag: file.metadata.etag,
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

  async streamFile(fileName, range = null) {
    try {
      const file = this.bucket.file(fileName);
      const options = {};
      
      if (range) {
        options.start = range.start;
        options.end = range.end;
      }
      
      return file.createReadStream(options);
    } catch (error) {
      throw new Error(`Failed to stream file: ${error.message}`);
    }
  }
}

// Video Processing Service
class VideoProcessingService {
  static async extractMetadata(filePath) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) {
          reject(new Error(`Failed to extract metadata: ${err.message}`));
          return;
        }

        const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
        const audioStream = metadata.streams.find(stream => stream.codec_type === 'audio');

        if (!videoStream) {
          reject(new Error('No video stream found'));
          return;
        }

        resolve({
          duration: parseFloat(metadata.format.duration) || 0,
          resolution: `${videoStream.width}x${videoStream.height}`,
          width: videoStream.width,
          height: videoStream.height,
          frameRate: eval(videoStream.r_frame_rate) || 30,
          bitrate: parseInt(metadata.format.bit_rate) || 0,
          codec: videoStream.codec_name,
          fileSize: parseInt(metadata.format.size) || 0,
          hasAudio: !!audioStream,
          audioCodec: audioStream?.codec_name,
        });
      });
    });
  }

  static async generateThumbnail(inputPath, outputPath, timeOffset = '00:00:05') {
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .screenshots({
          timestamps: [timeOffset],
          filename: path.basename(outputPath),
          folder: path.dirname(outputPath),
          size: '1920x960'
        })
        .on('end', () => resolve(outputPath))
        .on('error', (err) => reject(new Error(`Failed to generate thumbnail: ${err.message}`)));
    });
  }

  static async transcodeVideo(inputPath, outputPath, quality = '1080p') {
    const qualitySettings = {
      '4K': { width: 3840, height: 1920, bitrate: '20000k', crf: 18 },
      '1080p': { width: 1920, height: 960, bitrate: '8000k', crf: 23 },
      '720p': { width: 1280, height: 640, bitrate: '5000k', crf: 28 },
      '480p': { width: 854, height: 427, bitrate: '2500k', crf: 32 },
    };

    const settings = qualitySettings[quality] || qualitySettings['1080p'];

    return new Promise((resolve, reject) => {
      const command = ffmpeg(inputPath)
        .output(outputPath)
        .videoCodec('libx264')
        .audioCodec('aac')
        .size(`${settings.width}x${settings.height}`)
        .videoBitrate(settings.bitrate)
        .addOption('-crf', settings.crf)
        .addOption('-preset', 'medium')
        .addOption('-movflags', '+faststart') // Optimize for streaming
        .format('mp4');

      let progress = 0;
      command.on('progress', (progressInfo) => {
        progress = progressInfo.percent || 0;
        console.log(`Transcoding progress: ${progress.toFixed(1)}%`);
      });

      command.on('end', () => {
        console.log(`✅ Transcoding completed: ${outputPath}`);
        resolve({ outputPath, progress: 100 });
      });

      command.on('error', (err) => {
        console.error(`❌ Transcoding failed: ${err.message}`);
        reject(new Error(`Transcoding failed: ${err.message}`));
      });

      command.run();
    });
  }

  static detect360Video(metadata) {
    // Simple heuristic to detect 360 videos
    const { width, height } = metadata;
    const aspectRatio = width / height;
    
    // Common 360 video aspect ratios
    const is360 = aspectRatio >= 1.8 && aspectRatio <= 2.1; // Equirectangular: ~2:1
    
    return {
      is360Video: is360,
      projection: is360 ? 'equirectangular' : null,
    };
  }
}

// Analytics Service
class AnalyticsService {
  static async trackEvent(fileId, sessionId, eventType, data = {}) {
    if (!VideoAnalytics) return;

    try {
      await VideoAnalytics.create({
        fileId,
        sessionId,
        eventType,
        videoTime: data.videoTime,
        quality: data.quality,
        metadata: data.metadata || {},
        userAgent: data.userAgent,
        ipAddress: data.ipAddress,
        userId: data.userId,
      });
    } catch (error) {
      console.error('Failed to track analytics event:', error);
    }
  }

  static async getVideoStats(fileId) {
    if (!VideoAnalytics || !FileMetadata) return null;

    try {
      const file = await FileMetadata.findByPk(fileId);
      if (!file) return null;

      const analytics = await VideoAnalytics.findAll({
        where: { fileId },
        attributes: [
          'eventType',
          [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
          [sequelize.fn('AVG', sequelize.col('videoTime')), 'avgWatchTime'],
        ],
        group: ['eventType'],
        raw: true,
      });

      const uniqueViewers = await VideoAnalytics.count({
        where: { fileId, eventType: 'view_start' },
        distinct: true,
        col: 'sessionId',
      });

      return {
        file: {
          id: file.id,
          fileName: file.fileName,
          duration: file.duration,
          viewCount: file.viewCount,
        },
        analytics,
        uniqueViewers,
      };
    } catch (error) {
      console.error('Failed to get video stats:', error);
      return null;
    }
  }
}

// Session Service
class SessionService {
  static generateSessionId() {
    return crypto.randomBytes(32).toString('hex');
  }

  static async createSession(sessionData) {
    if (!UserSession) return null;

    try {
      return await UserSession.create({
        sessionId: this.generateSessionId(),
        ...sessionData,
      });
    } catch (error) {
      console.error('Failed to create session:', error);
      return null;
    }
  }

  static async getActiveSession(sessionId) {
    if (!UserSession) return null;

    try {
      return await UserSession.findOne({
        where: { sessionId, isActive: true },
      });
    } catch (error) {
      console.error('Failed to get session:', error);
      return null;
    }
  }
}

// Initialize storage service
const storageService = new CloudStorageService(process.env.GOOGLE_CLOUD_BUCKET_NAME || 'default-bucket');

// Utility functions
function isValidVideoFile(file) {
  const validTypes = [
    'video/mp4', 'video/quicktime', 'video/x-msvideo', 
    'video/avi', 'video/mov', 'video/x-ms-wmv', 'video/webm'
  ];
  return validTypes.includes(file.mimetype.toLowerCase());
}

function generateUniqueFileName(originalName, prefix = '360-videos') {
  const timestamp = Date.now();
  const randomStr = Math.random().toString(36).substring(2, 8);
  const extension = originalName.split('.').pop();
  const nameWithoutExt = originalName.replace(/\.[^/.]+$/, "");
  const sanitizedName = nameWithoutExt.replace(/[^a-zA-Z0-9-_]/g, '_');
  return `${prefix}/${timestamp}-${randomStr}-${sanitizedName}.${extension}`;
}

function parseRangeHeader(range, fileSize) {
  const parts = range.replace(/bytes=/, "").split("-");
  const start = parseInt(parts[0], 10);
  const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
  return { start, end };
}

// ROUTES

// Health check with enhanced info
app.get('/health', async (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '2.0.0',
    database: sequelize ? 'configured' : 'not configured',
    environment: process.env.NODE_ENV || 'development',
    authentication: 'using Cloud Run service account',
    bucket: process.env.GOOGLE_CLOUD_BUCKET_NAME || 'not configured',
    features: {
      videoStreaming: true,
      transcoding: true,
      analytics: !!VideoAnalytics,
      thumbnails: true,
      qualityLevels: true,
    }
  };

  // Test database connection
  if (sequelize) {
    try {
      await sequelize.authenticate();
      health.database = 'connected';
    } catch (error) {
      health.database = 'connection failed';
      health.status = 'degraded';
    }
  }

  res.json(health);
});

// Enhanced info endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'DuoVR Server v2.0 is running!',
    timestamp: new Date().toISOString(),
    endpoints: {
      health: '/health',
      files: {
        list: '/files',
        signedUrl: '/files/:fileName/signed-url',
        metadata: '/files/:fileName/metadata',
        stream: '/files/:fileName/stream',
        upload: '/files/upload',
        generateUploadUrl: '/files/generate-upload-url',
        transcode: '/files/:fileName/transcode',
        thumbnail: '/files/:fileName/thumbnail',
      },
      analytics: {
        track: '/analytics/track',
        stats: '/analytics/files/:fileId/stats',
        dashboard: '/analytics/dashboard',
      },
      sessions: {
        create: '/sessions/create',
        status: '/sessions/:sessionId',
      }
    },
    database: sequelize ? 'available' : 'not configured',
    bucket: process.env.GOOGLE_CLOUD_BUCKET_NAME || 'not configured'
  });
});

// Session management
app.post('/sessions/create', async (req, res) => {
  try {
    const { userId, deviceType, platform } = req.body;
    
    const session = await SessionService.createSession({
      userId,
      deviceType: deviceType || 'unknown',
      platform: platform || 'unknown',
    });

    if (session) {
      res.json({
        sessionId: session.sessionId,
        message: 'Session created successfully'
      });
    } else {
      res.json({
        sessionId: SessionService.generateSessionId(),
        message: 'Session created (no database)'
      });
    }
  } catch (error) {
    console.error('Error creating session:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/sessions/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await SessionService.getActiveSession(sessionId);
    
    if (session) {
      res.json(session);
    } else {
      res.status(404).json({ error: 'Session not found' });
    }
  } catch (error) {
    console.error('Error getting session:', error);
    res.status(500).json({ error: error.message });
  }
});

// Enhanced file upload with processing
app.post('/files/upload', async (req, res) => {
  try {
    if (!req.files || !req.files.video) {
      return res.status(400).json({ error: 'No video file uploaded' });
    }

    const videoFile = req.files.video;
    const { userId, tags, quality } = req.body;

    // Validate file type
    if (!isValidVideoFile(videoFile)) {
      return res.status(400).json({ 
        error: 'Invalid file type. Please upload video files only' 
      });
    }

    // Generate unique filename
    const destination = generateUniqueFileName(videoFile.name);
    console.log(`🎯 Generated upload destination: ${destination}`);

    // Extract video metadata
    const metadata = await VideoProcessingService.extractMetadata(videoFile.tempFilePath);
    const video360Detection = VideoProcessingService.detect360Video(metadata);

    // Upload to cloud storage
    await storageService.uploadFile(videoFile, destination, {
      originalFileName: videoFile.name,
      uploadedBy: userId || 'anonymous',
    });

    // Save metadata to database
    let fileMetadata = null;
    if (FileMetadata) {
      try {
        fileMetadata = await FileMetadata.create({
          fileName: path.basename(destination),
          originalFileName: videoFile.name,
          bucketName: process.env.GOOGLE_CLOUD_BUCKET_NAME,
          filePath: destination,
          fileSize: videoFile.size,
          mimeType: videoFile.mimetype,
          duration: metadata.duration,
          resolution: metadata.resolution,
          frameRate: metadata.frameRate,
          bitrate: metadata.bitrate,
          codec: metadata.codec,
          is360Video: video360Detection.is360Video,
          projection: video360Detection.projection,
          userId: userId || null,
          tags: tags ? tags.split(',').map(tag => tag.trim()) : [],
          processingStatus: 'pending',
        });

        console.log(`💾 Saved metadata to database: ${fileMetadata.id}`);

        // Start background processing
        if (quality && quality !== 'original') {
          processVideoInBackground(fileMetadata.id, destination, quality);
        }
      } catch (dbError) {
        console.error('⚠️ Failed to save metadata to database:', dbError);
      }
    }

    res.json({
      message: 'Video uploaded successfully',
      fileId: fileMetadata?.id || null,
      fileName: destination,
      metadata: {
        duration: metadata.duration,
        resolution: metadata.resolution,
        is360Video: video360Detection.is360Video,
        fileSize: videoFile.size,
      },
      processingStatus: 'pending'
    });

  } catch (error) {
    console.error('❌ Error uploading file:', error);
    res.status(500).json({ 
      error: 'Failed to upload file: ' + error.message 
    });
  }
});

// Generate signed upload URL (enhanced)
app.post('/files/generate-upload-url', async (req, res) => {
  try {
    const { fileName, fileType, fileSize, quality } = req.body;

    if (!fileName || !fileType) {
      return res.status(400).json({ error: 'fileName and fileType are required' });
    }

    // Validate file type
    const validTypes = [
      'video/mp4', 'video/quicktime', 'video/x-msvideo', 
      'video/avi', 'video/mov', 'video/webm'
    ];
    if (!validTypes.includes(fileType.toLowerCase())) {
      return res.status(400).json({ 
        error: 'Invalid file type. Please upload video files only' 
      });
    }

    // Check file size (max 8GB for direct uploads)
    const maxSize = 8 * 1024 * 1024 * 1024; // 8GB
    if (fileSize && fileSize > maxSize) {
      return res.status(400).json({ 
        error: 'File too large. Maximum size is 8GB for direct uploads' 
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
    });

    console.log(`✅ Generated signed upload URL for: ${destination}`);

    // Pre-save metadata to database if available
    let fileMetadata = null;
    if (FileMetadata) {
      try {
        fileMetadata = await FileMetadata.create({
          fileName: path.basename(destination),
          originalFileName: fileName,
          bucketName: process.env.GOOGLE_CLOUD_BUCKET_NAME,
          filePath: destination,
          fileSize: fileSize || null,
          mimeType: fileType,
          userId: req.body.userId || null,
          processingStatus: 'pending',
        });
        console.log(`💾 Pre-saved metadata to database: ${fileMetadata.id}`);
      } catch (dbError) {
        console.error('⚠️ Failed to save metadata to database:', dbError);
      }
    }

    res.json({
      uploadUrl: signedUrl,
      destination: destination,
      fileId: fileMetadata?.id || null,
      expiresIn: '1 hour',
      maxSize: '8GB',
      suggestedQuality: quality || 'original'
    });

  } catch (error) {
    console.error('❌ Error generating upload URL:', error);
    res.status(500).json({ 
      error: 'Failed to generate upload URL: ' + error.message 
    });
  }
});

// Get file metadata endpoint
app.get('/files/:fileName/metadata', async (req, res) => {
  try {
    const { fileName } = req.params;
    
    console.log(`🔍 Getting metadata for: ${fileName}`);

    // Check if file exists in cloud storage
    const exists = await storageService.fileExists(fileName);
    if (!exists) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Get cloud storage metadata
    const cloudMetadata = await storageService.getFileMetadata(fileName);
    
    // Get database metadata if available
    let dbMetadata = null;
    if (FileMetadata) {
      try {
        dbMetadata = await FileMetadata.findOne({
          where: { filePath: fileName }
        });
      } catch (dbError) {
        console.error('⚠️ Failed to fetch from database:', dbError);
      }
    }

    const response = {
      fileName: fileName,
      size: parseInt(cloudMetadata.size),
      contentType: cloudMetadata.contentType,
      updated: cloudMetadata.updated,
      etag: cloudMetadata.etag,
    };

    if (dbMetadata) {
      response.id = dbMetadata.id;
      response.originalFileName = dbMetadata.originalFileName;
      response.duration = dbMetadata.duration;
      response.resolution = dbMetadata.resolution;
      response.frameRate = dbMetadata.frameRate;
      response.bitrate = dbMetadata.bitrate;
      response.codec = dbMetadata.codec;
      response.is360Video = dbMetadata.is360Video;
      response.projection = dbMetadata.projection;
      response.thumbnailPath = dbMetadata.thumbnailPath;
      response.qualityLevels = dbMetadata.qualityLevels;
      response.viewCount = dbMetadata.viewCount;
      response.lastViewed = dbMetadata.lastViewed;
      response.tags = dbMetadata.tags;
      response.processingStatus = dbMetadata.processingStatus;
    }

    res.json(response);
  } catch (error) {
    console.error('❌ Error getting file metadata:', error);
    res.status(500).json({ error: error.message });
  }
});

// Video streaming endpoint with range support
app.get('/files/:fileName/stream', async (req, res) => {
  try {
    const { fileName } = req.params;
    const { quality = 'original' } = req.query;
    
    console.log(`🎬 Streaming request for: ${fileName}, quality: ${quality}`);

    // Determine the actual file path based on quality
    let filePath = fileName;
    if (quality !== 'original' && FileMetadata) {
      const fileRecord = await FileMetadata.findOne({
        where: { filePath: fileName }
      });
      
      if (fileRecord && fileRecord.qualityLevels[quality]) {
        filePath = fileRecord.qualityLevels[quality].path;
      }
    }

    // Check if file exists
    const exists = await storageService.fileExists(filePath);
    if (!exists) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Get file metadata for range requests
    const metadata = await storageService.getFileMetadata(filePath);
    const fileSize = parseInt(metadata.size);

    // Handle range requests for video streaming
    const range = req.headers.range;
    if (range) {
      const { start, end } = parseRangeHeader(range, fileSize);
      const chunkSize = (end - start) + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': metadata.contentType || 'video/mp4',
        'Cache-Control': 'public, max-age=31536000',
      });

      // Stream the requested range
      const stream = await storageService.streamFile(filePath, { start, end });
      stream.pipe(res);
    } else {
      // Stream entire file
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': metadata.contentType || 'video/mp4',
        'Cache-Control': 'public, max-age=31536000',
        'Accept-Ranges': 'bytes',
      });

      const stream = await storageService.streamFile(filePath);
      stream.pipe(res);
    }

    // Track analytics
    const sessionId = req.headers['x-session-id'];
    if (sessionId && FileMetadata) {
      const fileRecord = await FileMetadata.findOne({
        where: { filePath: fileName }
      });
      
      if (fileRecord) {
        AnalyticsService.trackEvent(fileRecord.id, sessionId, 'view_start', {
          quality,
          userAgent: req.headers['user-agent'],
          ipAddress: req.ip,
        });
        
        // Update view count
        await fileRecord.increment('viewCount');
        await fileRecord.update({ lastViewed: new Date() });
      }
    }

  } catch (error) {
    console.error('❌ Error streaming file:', error);
    res.status(500).json({ error: error.message });
  }
});

// Enhanced signed URL endpoint
app.get('/files/:fileName/signed-url', async (req, res) => {
  try {
    const { fileName } = req.params;
    const { expiresInMinutes = 60, action = 'read', quality = 'original' } = req.query;

    console.log(`🔍 Checking if file exists: ${fileName} in bucket: ${process.env.GOOGLE_CLOUD_BUCKET_NAME}`);

    // Determine the actual file path based on quality
    let filePath = fileName;
    if (quality !== 'original' && FileMetadata) {
      const fileRecord = await FileMetadata.findOne({
        where: { filePath: fileName }
      });
      
      if (fileRecord && fileRecord.qualityLevels[quality]) {
        filePath = fileRecord.qualityLevels[quality].path;
        console.log(`📹 Using quality-specific file: ${filePath}`);
      }
    }

    const exists = await storageService.fileExists(filePath);
    if (!exists) {
      console.log(`❌ File not found: ${filePath}`);
      return res.status(404).json({ error: 'File not found' });
    }

    console.log(`✅ File found: ${filePath}, generating signed URL`);

    const signedUrl = await storageService.generateSignedUrl(filePath, {
      action,
      expiresInMinutes: parseInt(expiresInMinutes),
    });

    console.log(`✅ Signed URL generated successfully for: ${filePath}`);

    // Get additional metadata if available
    let metadata = {};
    if (FileMetadata) {
      const fileRecord = await FileMetadata.findOne({
        where: { filePath: fileName }
      });
      
      if (fileRecord) {
        metadata = {
          duration: fileRecord.duration,
          resolution: fileRecord.resolution,
          is360Video: fileRecord.is360Video,
          availableQualities: Object.keys(fileRecord.qualityLevels || {}),
        };
      }
    }

    res.json({ 
      signedUrl,
      fileName: filePath,
      originalFileName: fileName,
      quality,
      expiresIn: `${expiresInMinutes} minutes`,
      action,
      metadata
    });
  } catch (error) {
    console.error('❌ Error generating signed URL:', error);
    res.status(500).json({ error: error.message });
  }
});

// Video transcoding endpoint
app.post('/files/:fileName/transcode', async (req, res) => {
  try {
    const { fileName } = req.params;
    const { quality = '1080p' } = req.body;

    if (!FileMetadata || !TranscodingJob) {
      return res.status(503).json({ error: 'Transcoding service not available' });
    }

    // Find the file record
    const fileRecord = await FileMetadata.findOne({
      where: { filePath: fileName }
    });

    if (!fileRecord) {
      return res.status(404).json({ error: 'File not found in database' });
    }

    // Check if this quality already exists
    if (fileRecord.qualityLevels && fileRecord.qualityLevels[quality]) {
      return res.json({
        message: 'Quality level already exists',
        status: 'completed',
        outputPath: fileRecord.qualityLevels[quality].path
      });
    }

    // Create transcoding job
    const job = await TranscodingJob.create({
      fileId: fileRecord.id,
      targetQuality: quality,
      status: 'queued',
    });

    // Start transcoding in background
    processTranscodingJob(job.id);

    res.json({
      message: 'Transcoding job created',
      jobId: job.id,
      status: 'queued',
      estimatedDuration: fileRecord.duration ? Math.ceil(fileRecord.duration * 0.5) : null, // Rough estimate
    });

  } catch (error) {
    console.error('❌ Error creating transcoding job:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get transcoding job status
app.get('/transcode/:jobId/status', async (req, res) => {
  try {
    const { jobId } = req.params;

    if (!TranscodingJob) {
      return res.status(503).json({ error: 'Transcoding service not available' });
    }

    const job = await TranscodingJob.findByPk(jobId);
    if (!job) {
      return res.status(404).json({ error: 'Transcoding job not found' });
    }

    res.json({
      id: job.id,
      status: job.status,
      targetQuality: job.targetQuality,
      progress: job.progress,
      outputPath: job.outputPath,
      errorMessage: job.errorMessage,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
    });

  } catch (error) {
    console.error('❌ Error getting transcoding status:', error);
    res.status(500).json({ error: error.message });
  }
});

// Generate thumbnail endpoint
app.post('/files/:fileName/thumbnail', async (req, res) => {
  try {
    const { fileName } = req.params;
    const { timeOffset = '00:00:05' } = req.body;

    console.log(`🖼️ Generating thumbnail for: ${fileName}`);

    // Check if file exists
    const exists = await storageService.fileExists(fileName);
    if (!exists) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Generate signed URL for thumbnail generation
    const signedUrl = await storageService.generateSignedUrl(fileName, {
      action: 'read',
      expiresInMinutes: 10,
    });

    // Generate thumbnail path
    const thumbnailPath = fileName.replace(/\.[^/.]+$/, '_thumbnail.jpg');
    const tempThumbnailPath = `/tmp/${path.basename(thumbnailPath)}`;

    // Generate thumbnail
    await VideoProcessingService.generateThumbnail(signedUrl, tempThumbnailPath, timeOffset);

    // Upload thumbnail to cloud storage
    const thumbnailData = await fs.readFile(tempThumbnailPath);
    await storageService.uploadFile({
      data: thumbnailData,
      name: path.basename(thumbnailPath),
      mimetype: 'image/jpeg'
    }, thumbnailPath);

    // Update database record
    if (FileMetadata) {
      await FileMetadata.update(
        { thumbnailPath },
        { where: { filePath: fileName } }
      );
    }

    // Clean up temp file
    await fs.unlink(tempThumbnailPath).catch(() => {});

    // Generate signed URL for the thumbnail
    const thumbnailSignedUrl = await storageService.generateSignedUrl(thumbnailPath, {
      action: 'read',
      expiresInMinutes: 60,
    });

    res.json({
      message: 'Thumbnail generated successfully',
      thumbnailPath,
      thumbnailUrl: thumbnailSignedUrl,
      timeOffset
    });

  } catch (error) {
    console.error('❌ Error generating thumbnail:', error);
    res.status(500).json({ error: error.message });
  }
});

// Analytics endpoints
app.post('/analytics/track', async (req, res) => {
  try {
    const { fileId, sessionId, eventType, videoTime, quality, metadata } = req.body;

    if (!fileId || !sessionId || !eventType) {
      return res.status(400).json({ error: 'fileId, sessionId, and eventType are required' });
    }

    await AnalyticsService.trackEvent(fileId, sessionId, eventType, {
      videoTime,
      quality,
      metadata,
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });

    res.json({ message: 'Event tracked successfully' });

  } catch (error) {
    console.error('❌ Error tracking analytics:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/analytics/files/:fileId/stats', async (req, res) => {
  try {
    const { fileId } = req.params;
    const stats = await AnalyticsService.getVideoStats(fileId);

    if (!stats) {
      return res.status(404).json({ error: 'File not found or analytics not available' });
    }

    res.json(stats);

  } catch (error) {
    console.error('❌ Error getting analytics:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/analytics/dashboard', async (req, res) => {
  try {
    if (!VideoAnalytics || !FileMetadata) {
      return res.status(503).json({ error: 'Analytics not available' });
    }

    const totalVideos = await FileMetadata.count();
    const totalViews = await VideoAnalytics.count({ where: { eventType: 'view_start' } });
    const uniqueViewers = await VideoAnalytics.count({
      where: { eventType: 'view_start' },
      distinct: true,
      col: 'sessionId'
    });

    const topVideos = await FileMetadata.findAll({
      order: [['viewCount', 'DESC']],
      limit: 10,
      attributes: ['id', 'fileName', 'originalFileName', 'viewCount', 'duration']
    });

    const recentActivity = await VideoAnalytics.findAll({
      order: [['timestamp', 'DESC']],
      limit: 50,
      include: [{
        model: FileMetadata,
        attributes: ['fileName', 'originalFileName']
      }]
    });

    res.json({
      summary: {
        totalVideos,
        totalViews,
        uniqueViewers,
        avgViewsPerVideo: totalVideos > 0 ? (totalViews / totalVideos).toFixed(1) : 0
      },
      topVideos,
      recentActivity
    });

  } catch (error) {
    console.error('❌ Error getting dashboard data:', error);
    res.status(500).json({ error: error.message });
  }
});

// Enhanced list files endpoint
app.get('/files', async (req, res) => {
  try {
    const { prefix, limit = 50, pageToken, includeAnalytics = false } = req.query;
    
    const files = await storageService.listFiles(prefix, { limit: parseInt(limit), pageToken });
    
    let dbFiles = [];
    if (FileMetadata) {
      try {
        const whereClause = prefix ? { filePath: { [sequelize.Op.like]: `${prefix}%` } } : {};
        
        dbFiles = await FileMetadata.findAll({
          where: whereClause,
          order: [['uploadedAt', 'DESC']],
          limit: parseInt(limit),
          ...(includeAnalytics === 'true' && {
            include: [{
              model: VideoAnalytics,
              attributes: ['eventType'],
              required: false
            }]
          })
        });
      } catch (dbError) {
        console.error('⚠️ Failed to fetch from database:', dbError);
      }
    }

    // Merge cloud storage and database data
    const mergedFiles = files.map(file => {
      const dbFile = dbFiles.find(db => db.filePath === file.name);
      return {
        ...file,
        ...(dbFile && {
          id: dbFile.id,
          originalFileName: dbFile.originalFileName,
          duration: dbFile.duration,
          resolution: dbFile.resolution,
          is360Video: dbFile.is360Video,
          viewCount: dbFile.viewCount,
          processingStatus: dbFile.processingStatus,
          tags: dbFile.tags,
          availableQualities: Object.keys(dbFile.qualityLevels || {})
        })
      };
    });

    res.json({
      files: mergedFiles,
      totalFiles: files.length,
      hasMore: files.length === parseInt(limit),
      summary: {
        totalSize: files.reduce((sum, file) => sum + (file.size || 0), 0),
        videoCount: files.filter(f => f.contentType?.startsWith('video/')).length,
        avgFileSize: files.length > 0 ? Math.round(files.reduce((sum, file) => sum + (file.size || 0), 0) / files.length) : 0
      }
    });
  } catch (error) {
    console.error('Error listing files:', error);
    res.status(500).json({ error: error.message });
  }
});

// Background processing functions
async function processVideoInBackground(fileId, filePath, quality) {
  try {
    console.log(`🔄 Starting background processing for file: ${fileId}`);
    
    if (!FileMetadata) return;

    const fileRecord = await FileMetadata.findByPk(fileId);
    if (!fileRecord) return;

    await fileRecord.update({ processingStatus: 'processing' });

    // Generate signed URL for processing
    const signedUrl = await storageService.generateSignedUrl(filePath, {
      action: 'read',
      expiresInMinutes: 120, // 2 hours for processing
    });

    // Extract metadata if not already done
    if (!fileRecord.duration) {
      try {
        const metadata = await VideoProcessingService.extractMetadata(signedUrl);
        const video360Detection = VideoProcessingService.detect360Video(metadata);
        
        await fileRecord.update({
          duration: metadata.duration,
          resolution: metadata.resolution,
          frameRate: metadata.frameRate,
          bitrate: metadata.bitrate,
          codec: metadata.codec,
          is360Video: video360Detection.is360Video,
          projection: video360Detection.projection,
        });
      } catch (metadataError) {
        console.error('Failed to extract metadata:', metadataError);
      }
    }

    // Generate thumbnail
    try {
      const thumbnailPath = filePath.replace(/\.[^/.]+$/, '_thumbnail.jpg');
      const tempThumbnailPath = `/tmp/${path.basename(thumbnailPath)}`;
      
      await VideoProcessingService.generateThumbnail(signedUrl, tempThumbnailPath);
      
      const thumbnailData = await fs.readFile(tempThumbnailPath);
      await storageService.uploadFile({
        data: thumbnailData,
        name: path.basename(thumbnailPath),
        mimetype: 'image/jpeg'
      }, thumbnailPath);
      
      await fileRecord.update({ thumbnailPath });
      await fs.unlink(tempThumbnailPath).catch(() => {});
      
      console.log(`✅ Generated thumbnail for: ${fileId}`);
    } catch (thumbnailError) {
      console.error('Failed to generate thumbnail:', thumbnailError);
    }

    await fileRecord.update({ 
      processingStatus: 'completed',
      isProcessed: true 
    });

    console.log(`✅ Completed background processing for file: ${fileId}`);

  } catch (error) {
    console.error(`❌ Background processing failed for file ${fileId}:`, error);
    
    if (FileMetadata) {
      const fileRecord = await FileMetadata.findByPk(fileId);
      if (fileRecord) {
        await fileRecord.update({ processingStatus: 'failed' });
      }
    }
  }
}

async function processTranscodingJob(jobId) {
  try {
    if (!TranscodingJob || !FileMetadata) return;

    const job = await TranscodingJob.findByPk(jobId, {
      include: [{ model: FileMetadata }]
    });

    if (!job || !job.FileMetadata) {
      console.error(`Transcoding job ${jobId} not found`);
      return;
    }

    console.log(`🔄 Starting transcoding job: ${jobId}`);

    await job.update({ 
      status: 'processing', 
      startedAt: new Date() 
    });

    const inputFile = job.FileMetadata;
    const outputPath = inputFile.filePath.replace(/\.[^/.]+$/, `_${job.targetQuality}.mp4`);

    // Generate signed URLs
    const inputSignedUrl = await storageService.generateSignedUrl(inputFile.filePath, {
      action: 'read',
      expiresInMinutes: 240, // 4 hours for transcoding
    });

    const tempOutputPath = `/tmp/${path.basename(outputPath)}`;

    // Transcode video
    await VideoProcessingService.transcodeVideo(inputSignedUrl, tempOutputPath, job.targetQuality);

    // Upload transcoded video
    const transcodedData = await fs.readFile(tempOutputPath);
    await storageService.uploadFile({
      data: transcodedData,
      name: path.basename(outputPath),
      mimetype: 'video/mp4'
    }, outputPath);

    // Update quality levels in file metadata
    const qualityLevels = inputFile.qualityLevels || {};
    qualityLevels[job.targetQuality] = {
      path: outputPath,
      createdAt: new Date().toISOString()
    };

    await inputFile.update({ qualityLevels });

    await job.update({
      status: 'completed',
      outputPath,
      progress: 100,
      completedAt: new Date()
    });

    // Clean up temp file
    await fs.unlink(tempOutputPath).catch(() => {});

    console.log(`✅ Completed transcoding job: ${jobId}`);

  } catch (error) {
    console.error(`❌ Transcoding job ${jobId} failed:`, error);
    
    if (TranscodingJob) {
      await TranscodingJob.update(
        { 
          status: 'failed', 
          errorMessage: error.message,
          completedAt: new Date()
        },
        { where: { id: jobId } }
      );
    }
  }
}

// Database operations
app.get('/db/files', async (req, res) => {
  if (!FileMetadata) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  
  try {
    const { includeAnalytics = false } = req.query;
    
    const files = await FileMetadata.findAll({
      order: [['uploadedAt', 'DESC']],
      ...(includeAnalytics === 'true' && {
        include: [{
          model: VideoAnalytics,
          attributes: ['eventType', 'timestamp'],
          required: false
        }]
      })
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
    message: process.env.NODE_ENV === 'development' ? error.message : undefined,
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Route not found',
    availableEndpoints: [
      'GET /health',
      'GET /',
      'POST /sessions/create',
      'POST /files/upload',
      'POST /files/generate-upload-url',
      'GET /files/:fileName/metadata',
      'GET /files/:fileName/stream',
      'GET /files/:fileName/signed-url',
      'POST /files/:fileName/transcode',
      'POST /files/:fileName/thumbnail',
      'POST /analytics/track',
      'GET /analytics/files/:fileId/stats'
    ]
  });
});

// Database connection and server startup
async function startServer() {
  try {
    if (sequelize) {
      console.log('🔍 Testing database connection...');
      await sequelize.authenticate();
      await sequelize.sync({ alter: true });
      console.log('📊 Database models synchronized');
    } else {
      console.log('⚠️ No database configured, running without database features');
    }
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 DuoVR Server v2.0 running on port ${PORT}`);
      console.log(`📱 Health check: http://localhost:${PORT}/health`);
      console.log(`🪣 Using bucket: ${process.env.GOOGLE_CLOUD_BUCKET_NAME || 'not configured'}`);
      console.log(`📏 Max file size: 8GB`);
      console.log(`🎬 Features: Streaming, Transcoding, Analytics, Thumbnails`);
    });
  } catch (error) {
    console.error('❌ Database connection failed, but starting server anyway:', error.message);
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 DuoVR Server v2.0 running on port ${PORT} (database connection failed)`);
      console.log(`📱 Health check: http://localhost:${PORT}/health`);
      console.log(`🪣 Using bucket: ${process.env.GOOGLE_CLOUD_BUCKET_NAME || 'not configured'}`);
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