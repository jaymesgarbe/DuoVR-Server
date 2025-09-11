# DuoVR Server

A cloud-based video streaming and processing system designed specifically for VR applications, with robust support for 360-degree video content. This project provides a complete backend solution for Unity VR applications to upload, process, and stream high-quality video content from Google Cloud.

## 🎯 Overview

DuoVR Server is a Node.js/Express application that runs on Google Cloud Run, providing:

- **Video Upload & Storage**: Handle large video files (up to 8GB) with Google Cloud Storage
- **360° Video Support**: Automatic detection and optimization for VR content
- **Video Streaming**: HTTP range request support for efficient streaming
- **Video Processing**: Automatic transcoding, thumbnail generation, and metadata extraction
- **Analytics**: Optional video viewing statistics and user engagement tracking
- **Unity Integration**: Complete C# client library for seamless VR integration

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
- Docker installed (for local development)

### 1. Clone and Deploy

```bash
# Clone the repository
git clone <your-repo-url>
cd duovr-server

# Make deployment script executable
chmod +x deploy.sh

# Deploy to Google Cloud Run
./deploy.sh
```

The deployment script will:
- Enable required Google Cloud APIs
- Build and push Docker image
- Deploy to Cloud Run with appropriate configuration
- Create storage bucket if needed
- Output your service URL

### 2. Get Your Service URL

```bash
SERVICE_URL=$(gcloud run services describe duovr-server \
  --platform managed \
  --region us-west1 \
  --format 'value(status.url)')

echo "Your DuoVR Server: $SERVICE_URL"
```

### 3. Test Your Deployment

```bash
# Quick health check
curl "$SERVICE_URL/health"

# Expected response:
# {
#   "status": "healthy",
#   "version": "2.0.0",
#   "database": "not configured",  # This is normal initially
#   "features": {
#     "videoStreaming": true,
#     "transcoding": true,
#     "analytics": false  # Requires database
#   }
# }
```

## 🧪 Testing Your Instance

### Comprehensive Health Check

Create a test script to verify all functionality:

```bash
#!/bin/bash
SERVICE_URL="YOUR_SERVICE_URL_HERE"  # Replace with your actual URL

echo "🔍 Testing DuoVR Server..."

# Test 1: Health Check
echo "1. Health check..."
curl -s "$SERVICE_URL/health" | jq '.'

# Test 2: API Info
echo "2. API endpoints..."
curl -s "$SERVICE_URL/" | jq '.endpoints'

# Test 3: File listing (empty initially)
echo "3. File listing..."
curl -s "$SERVICE_URL/files" | jq '.files | length'

# Test 4: Generate upload URL
echo "4. Upload URL generation..."
curl -s -X POST "$SERVICE_URL/files/generate-upload-url" \
  -H "Content-Type: application/json" \
  -d '{"fileName":"test.mp4","fileType":"video/mp4","fileSize":1000000}' \
  | jq '.uploadUrl'

echo "✅ All tests completed!"
```

### Test File Upload

```bash
# Upload a test video file
curl -X POST "$SERVICE_URL/files/upload" \
  -F "video=@your-test-video.mp4" \
  -F "userId=test-user" \
  -F "quality=1080p"

# Check uploaded files
curl "$SERVICE_URL/files" | jq '.files'
```

## 🎮 Unity Integration

### Setup URLLoader in Unity

1. Copy `URLLoader.cs` to your Unity project's Scripts folder
2. Update the server URL in your Unity script:

```csharp
[Header("Server Configuration")]
[SerializeField] private string serverUrl = "YOUR_SERVICE_URL_HERE";
```

### Basic Usage

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

// Load and play a video
loader.LoadVideo("360-videos/my-video.mp4");
```

## 🗄️ Database Setup (Optional - For Advanced Features)

The server works without a database, but you'll miss out on analytics, metadata storage, and transcoding job tracking.

### Enable Database Features

```bash
# 1. Enable Cloud SQL API
gcloud services enable sqladmin.googleapis.com

# 2. Create PostgreSQL instance
gcloud sql instances create duovr-db \
    --database-version=POSTGRES_15 \
    --tier=db-f1-micro \
    --region=us-west1 \
    --storage-size=10GB

# 3. Create database and user
gcloud sql databases create duovr_db --instance=duovr-db
gcloud sql users create duovr_user \
    --instance=duovr-db \
    --password=$(openssl rand -base64 24)

# 4. Get connection details
CONNECTION_NAME=$(gcloud sql instances describe duovr-db \
    --format='value(connectionName)')

# 5. Update Cloud Run service
gcloud run services update duovr-server \
    --add-cloudsql-instances $CONNECTION_NAME \
    --update-env-vars "DB_HOST=/cloudsql/$CONNECTION_NAME,DB_NAME=duovr_db,DB_USER=duovr_user,DB_PASSWORD=your-password"
```

### With Database Enabled, You Get:

- **Video Analytics**: View counts, watch time, user engagement
- **Metadata Storage**: Video resolution, duration, 360° detection
- **Transcoding Jobs**: Background video processing status
- **User Sessions**: Track VR session analytics
- **Advanced Search**: Filter videos by tags, resolution, etc.

```bash
# Test analytics endpoint
curl "$SERVICE_URL/analytics/dashboard"

# View video statistics
curl "$SERVICE_URL/analytics/files/{fileId}/stats"
```

## 📊 API Endpoints

### Core Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Service health check |
| `GET` | `/` | API documentation |
| `GET` | `/files` | List uploaded files |
| `POST` | `/files/upload` | Upload video file |
| `GET` | `/files/{fileName}/signed-url` | Get streaming URL |
| `GET` | `/files/{fileName}/stream` | Stream video with range support |
| `GET` | `/files/{fileName}/metadata` | Get video metadata |

### Advanced Endpoints (Database Required)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/files/{fileName}/transcode` | Transcode to different quality |
| `POST` | `/files/{fileName}/thumbnail` | Generate video thumbnail |
| `POST` | `/analytics/track` | Track viewing events |
| `GET` | `/analytics/dashboard` | Analytics dashboard |
| `POST` | `/sessions/create` | Create user session |

## ⚙️ Configuration

### Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `PORT` | Server port | `3000` | No |
| `NODE_ENV` | Environment | `production` | No |
| `GOOGLE_CLOUD_PROJECT_ID` | GCP Project ID | - | Yes |
| `GOOGLE_CLOUD_BUCKET_NAME` | Storage bucket | - | Yes |
| `DB_HOST` | Database host | - | No |
| `DB_NAME` | Database name | `duovr_db` | No |
| `DB_USER` | Database user | `duovr_user` | No |
| `DB_PASSWORD` | Database password | - | No |

### Resource Limits

```yaml
# Default Cloud Run configuration
Memory: 4Gi
CPU: 2
Max Instances: 10
Timeout: 3600s (1 hour)
Max File Size: 8GB
```

## 🛠️ Development

### Local Development

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your configuration

# Run locally
npm run dev

# Test with Docker
docker build -t duovr-server .
docker run -p 3000:3000 duovr-server
```

### Docker Compose (with PostgreSQL)

```bash
# Start full stack locally
docker-compose up -d

# View logs
docker-compose logs -f duovr-server
```

## 🚨 Troubleshooting

### Common Issues

1. **"Database not configured"** - This is normal without database setup. Core features still work.

2. **"File not found"** - Check your bucket name and file paths. Files must be uploaded through the API.

3. **Upload timeouts** - Large files (>2GB) should use the signed upload URL method instead of direct upload.

4. **Permission errors** - Ensure your service account has Storage Admin and Cloud SQL Client roles.

### Debug Commands

```bash
# View Cloud Run logs
gcloud logs tail /google.com/cloud/run/job-name=duovr-server --limit=50

# Check service configuration
gcloud run services describe duovr-server --platform managed --region us-west1

# Test storage bucket access
gsutil ls gs://your-bucket-name/

# Verify service account permissions
gcloud projects get-iam-policy your-project-id
```

## 🔒 Security

- **Authentication**: Uses Google Cloud service account
- **CORS**: Configured for Unity and web clients
- **Rate Limiting**: Built-in request rate limiting
- **Signed URLs**: Time-limited file access
- **Input Validation**: File type and size validation
- **Helmet.js**: Security headers and CSP

## 📈 Monitoring

### Built-in Metrics

- Health check endpoint with service status
- Performance logging (FPS, memory usage)
- Video analytics (views, watch time)
- Error tracking and logging

### Google Cloud Monitoring

Access metrics in Google Cloud Console:
- **Cloud Run Metrics**: CPU, memory, request count
- **Cloud Storage Metrics**: Upload/download bandwidth
- **Cloud SQL Metrics**: Database performance (if enabled)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test with your own Google Cloud project
5. Submit a pull request

## 📄 License

[Your License Here]

## 🆘 Support

- **Issues**: [GitHub Issues](your-repo-url/issues)
- **Documentation**: This README and inline code comments
- **Google Cloud**: [Cloud Run Documentation](https://cloud.google.com/run/docs)

---

**Happy VR Development! 🥽✨**
