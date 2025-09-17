# DuoVR Server

A production-ready cloud-based video streaming and processing system designed specifically for VR applications, with robust support for 360-degree video content. This project provides a complete backend solution for Unity VR applications to upload, process, and stream high-quality video content from Google Cloud.

## 🎯 Overview

DuoVR Server is a Node.js/Express application that runs on Google Cloud Run, providing:

- **Video Upload & Storage**: Handle large video files (up to 8GB) with Google Cloud Storage
- **360° Video Support**: Automatic detection and optimization for VR content
- **Video Streaming**: HTTP range request support for efficient VR streaming
- **Video Processing**: Automatic transcoding, thumbnail generation, and metadata extraction
- **Analytics**: Optional video viewing statistics and user engagement tracking
- **Unity Integration**: Complete C# client library for seamless VR integration
- **Production-Ready**: Multiple deployment methods with comprehensive error handling

## 🏗️ Architecture

```
Unity VR App (URLLoader.cs) 
    ↓ HTTPS
Google Cloud Run (DuoVR Server)
    ↓ 
Google Cloud Storage (Video Files)
    ↓ (Optional)
Cloud SQL PostgreSQL (Analytics & Metadata)
```

## 🚀 Quick Start

### Prerequisites

- Google Cloud Project with billing enabled
- Google Cloud CLI installed and authenticated
- Node.js 18+ (for local development)
- Docker (optional, for local testing)

### 1. Clone and Setup

```bash
# Clone the repository
git clone https://github.com/your-username/duovr-server.git
cd duovr-server

# Run one-time setup to fix any deployment issues
chmod +x fix-all-deployment-issues.sh
./fix-all-deployment-issues.sh
```

### 2. Deploy to Production

```bash
# Deploy with automatic fallback methods
chmod +x manual-deploy.sh
./manual-deploy.sh
```

The deployment script will:
- Try multiple build methods (Cloud Build → Custom Config → Direct Docker)
- Deploy to Cloud Run with production configuration (4Gi memory, 2 CPU)
- Configure service account permissions
- Set up environment variables for video processing
- Output your service URL

### 3. Get Your Service URL

```bash
# Get your deployed service URL
SERVICE_URL=$(gcloud run services describe duovr-server \
  --platform managed \
  --region us-west1 \
  --format 'value(status.url)')

echo "Your DuoVR Server: $SERVICE_URL"
```

### 4. Test Your Deployment

```bash
# Run comprehensive tests
chmod +x tests/test-duovr-server.sh
./tests/test-duovr-server.sh

# Expected results: 11/11 tests passed
```

## 🧪 Testing Your Instance

### Comprehensive Test Suite

Run the full test suite to verify all functionality:

```bash
# Comprehensive testing with detailed diagnostics
./tests/test-duovr-server.sh
```

The test suite checks:
- ✅ Health endpoint and server status
- ✅ API endpoints and CORS configuration  
- ✅ File upload URL generation (with signBlob permissions)
- ✅ Video streaming capabilities
- ✅ Session management
- ✅ Analytics tracking
- ✅ Storage bucket configuration
- ✅ Error handling

### Quick Health Check

```bash
# Quick test for basic functionality
curl "$SERVICE_URL/health"

# Expected response:
# {
#   "status": "healthy",
#   "version": "2.0.0", 
#   "database": "not configured",
#   "features": {
#     "videoStreaming": true,
#     "transcoding": true,
#     "analytics": false,
#     "thumbnails": true
#   }
# }
```

### Local Development Testing

```bash
# Test locally before deploying
./tests/test-local.sh
```

## 🎮 Unity Integration

### Setup URLLoader in Unity

1. Copy `URLLoader.cs` to your Unity project's Scripts folder
2. Update the server URL in your Unity script:

```csharp
[Header("Server Configuration")]
[SerializeField] private string serverUrl = "YOUR_ACTUAL_SERVICE_URL";
```

### Unity Testing

1. Copy `tests/UnityTestScript.cs` to your Unity project
2. Attach `DuoVRServerTester` to a GameObject
3. Update the server URL and run tests from Unity

### Basic Usage Example

```csharp
// Attach to a GameObject with VideoPlayer component
var loader = GetComponent<DuoVRVideoLoader>();

// Set up event listeners
loader.OnVideoLoaded += (fileName) => {
    Debug.Log($"Video loaded: {fileName}");
    loader.PlayVideo();
};

loader.OnVideoLoadFailed += (error) => {
    Debug.LogError($"Failed to load video: {error}");
};

// Load and play a 360° video
loader.LoadVideo("360-videos/my-vr-video.mp4");
```

### Upload Videos from Unity

```csharp
// Generate upload URL
StartCoroutine(GetUploadUrl("my-video.mp4", (uploadUrl) => {
    // Upload video using the signed URL
    StartCoroutine(UploadVideo(uploadUrl, videoBytes));
}));
```

## 📁 Project Structure

```
duovr-server/
├── server.js                          # Main Node.js server application
├── URLLoader.cs                        # Unity VR client integration
├── package.json                        # Node.js dependencies
├── Dockerfile                          # Container configuration
├── docker-compose.yaml                 # Local development stack
├── 
├── # Deployment Scripts
├── manual-deploy.sh                    # Main production deployment (recommended)
├── fix-all-deployment-issues.sh       # One-time setup and troubleshooting
├── check-service-account.sh            # Service account verification
├── cloudbuild.sh                       # Cloud Build configuration
├── 
├── # Testing Scripts  
├── tests/
│   ├── test-duovr-server.sh           # Comprehensive test suite
│   ├── test-local.sh                  # Local development testing
│   ├── load-test.sh                   # Performance testing
│   ├── UnityTestScript.cs             # Unity integration tests
│   └── setup-database.sh              # Database setup (optional)
├── 
├── # Configuration
├── .env                                # Environment variables (create from .env.example)
├── .gitignore                          # Git ignore rules
├── .gcloudignore                      # Cloud deployment ignore rules
└── README.md                          # This file
```

## ⚙️ Configuration

### Environment Variables

Your `.env` file should contain:

```bash
# Google Cloud Configuration
GOOGLE_CLOUD_PROJECT_ID=plated-envoy-463521-d0
GOOGLE_CLOUD_BUCKET_NAME=duovr-files-bucket

# Database (Optional - leave empty to run without database)
DB_HOST=
DB_PASSWORD=

# Video Processing Features
ENABLE_TRANSCODING=true
ENABLE_THUMBNAILS=true
MAX_FILE_SIZE=8589934592  # 8GB
```

### Production Configuration

The deployment is optimized for VR video processing:

```yaml
# Cloud Run Configuration
Memory: 4Gi              # For video transcoding
CPU: 2                   # For parallel processing  
Timeout: 3600s           # 1 hour for large uploads
Max File Size: 8GB       # Large VR video support
Concurrent Requests: 10  # Optimized for video streaming
```

## 🔧 Development Workflow

### Local Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Test locally
./tests/test-local.sh
```

### Deployment

```bash
# Deploy to production (handles Cloud Build issues automatically)
./manual-deploy.sh

# Test deployment
./tests/test-duovr-server.sh
```

### Monitoring

```bash
# View logs
gcloud logs tail /google.com/cloud/run/job-name=duovr-server --limit=50

# Check service status
gcloud run services describe duovr-server --platform managed --region us-west1
```

## 📊 API Endpoints

### Core Video Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Service health check with feature status |
| `GET` | `/files` | List uploaded videos with metadata |
| `POST` | `/files/upload` | Direct video upload (up to 8GB) |
| `POST` | `/files/generate-upload-url` | Generate signed upload URL |
| `GET` | `/files/{fileName}/signed-url` | Get streaming URL with expiration |
| `GET` | `/files/{fileName}/stream` | Stream video with range support |
| `GET` | `/files/{fileName}/metadata` | Get video metadata and 360° detection |

### VR-Specific Features

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/files/{fileName}/transcode` | Transcode to VR-optimized qualities |
| `POST` | `/files/{fileName}/thumbnail` | Generate video thumbnails |
| `POST` | `/sessions/create` | Create VR session for analytics |
| `POST` | `/analytics/track` | Track VR viewing events |

## 🛠️ Troubleshooting

### Common Issues & Solutions

#### Upload URL Generation Fails
```bash
# Fix service account permissions
./fix-all-deployment-issues.sh
```

#### Cloud Build Issues
The deployment script automatically handles Cloud Build problems with multiple fallback methods:
1. Standard Cloud Build
2. Custom Cloud Build configuration  
3. Direct Docker build and push

#### Storage Bucket Issues
```bash
# Check if bucket exists
gsutil ls gs://duovr-files-bucket

# Create bucket if missing
gsutil mb gs://duovr-files-bucket
```

#### Permission Errors
```bash
# Verify service account
./check-service-account.sh
```

### Debug Commands

```bash
# Check deployment status
gcloud run services describe duovr-server --platform managed --region us-west1

# View recent logs
gcloud logs read /google.com/cloud/run/job-name=duovr-server --limit=20

# Test storage access
gsutil ls gs://duovr-files-bucket

# Verify service account permissions
gcloud projects get-iam-policy plated-envoy-463521-d0 \
  --flatten="bindings[].members" \
  --filter="bindings.members:serviceAccount:signedurl-getter@plated-envoy-463521-d0.iam.gserviceaccount.com"
```

### Performance Testing

```bash
# Run load tests
./tests/load-test.sh
```

## 🔒 Security Features

- **Service Account Authentication**: Uses Google Cloud service accounts (no API keys)
- **CORS Configuration**: Configured for Unity and web clients
- **Rate Limiting**: Built-in protection against abuse
- **Signed URLs**: Time-limited file access (1-hour expiration)
- **Input Validation**: File type and size validation for uploads
- **Security Headers**: Helmet.js with CSP protection

## 📈 Production Features

### Video Processing
- ✅ **Automatic 360° detection** using aspect ratio analysis
- ✅ **Multi-quality transcoding** (1080p, 720p, 480p)
- ✅ **Thumbnail generation** at configurable time offsets
- ✅ **Metadata extraction** (duration, resolution, codec)
- ✅ **Background processing** for large files

### Streaming Optimization
- ✅ **HTTP range requests** for efficient VR streaming
- ✅ **Multiple quality levels** for adaptive streaming
- ✅ **CDN-ready** with proper cache headers
- ✅ **Resumable uploads** for large files

### Analytics & Monitoring
- ✅ **VR session tracking** with device/platform detection
- ✅ **Video analytics** (views, watch time, engagement)
- ✅ **Performance monitoring** with built-in metrics
- ✅ **Error tracking** and comprehensive logging

## 🗄️ Database Setup (Optional)

For advanced features like analytics and transcoding job tracking, you can enable database support:

```bash
# Set up Cloud SQL PostgreSQL (optional)
./tests/setup-database.sh

# Update .env with database credentials
DB_HOST=/cloudsql/your-connection-name
DB_PASSWORD=your-secure-password
```

## 🎉 Success Criteria

Your DuoVR server is ready for production when:

- ✅ All 11 tests pass in the comprehensive test suite
- ✅ Unity can successfully load and stream videos
- ✅ Upload URL generation works (signBlob permissions configured)
- ✅ Storage bucket `duovr-files-bucket` exists and is accessible
- ✅ Cloud Run service is healthy and responding
- ✅ Service account has proper IAM roles

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Test your changes with `./tests/test-duovr-server.sh`
4. Deploy to your own Google Cloud project for testing
5. Submit a pull request

## 📄 License

MIT License - See LICENSE file for details

## 🆘 Support & Resources

- **GitHub Issues**: [Report bugs and request features](https://github.com/your-username/duovr-server/issues)
- **Google Cloud Documentation**: [Cloud Run](https://cloud.google.com/run/docs) | [Cloud Storage](https://cloud.google.com/storage/docs)
- **Unity Documentation**: [Video Player](https://docs.unity3d.com/ScriptReference/Video.VideoPlayer.html) | [UnityWebRequest](https://docs.unity3d.com/ScriptReference/Networking.UnityWebRequest.html)

---

**Ready to build amazing VR experiences! 🥽✨**

Built with ❤️ for the VR development community.