#!/bin/bash

# DuoVR Server Enhanced Deployment Script
set -e

# Configuration - UPDATE THESE VALUES
PROJECT_ID="plated-envoy-463521-d0"
SERVICE_NAME="duovr-server"
REGION="us-west1"
SERVICE_ACCOUNT="signedurl-getter@plated-envoy-463521-d0.iam.gserviceaccount.com"
BUCKET_NAME="duovr-files-bucket"

# Enhanced resource allocation for video processing
MEMORY="4Gi"
CPU="2"
MAX_INSTANCES="10"
MIN_INSTANCES="0"
TIMEOUT="3600"  # 1 hour timeout for video processing

echo "🚀 Starting enhanced deployment of DuoVR Server v2.0..."

# Get current project if not specified
if [ -z "$PROJECT_ID" ]; then
    PROJECT_ID=$(gcloud config get-value project)
    if [ -z "$PROJECT_ID" ]; then
        echo "❌ No project ID specified and no default project set."
        echo "Please run: gcloud config set project YOUR_PROJECT_ID"
        echo "Or set PROJECT_ID in this script."
        exit 1
    fi
fi

IMAGE_NAME="gcr.io/${PROJECT_ID}/${SERVICE_NAME}:v2.0"

echo "📋 Using project: $PROJECT_ID"
echo "📋 Using service account: $SERVICE_ACCOUNT"
echo "📋 Using bucket: $BUCKET_NAME"
echo "📋 Using account: $(gcloud config get-value account)"

# Verify project exists and is accessible
echo "🔍 Verifying project access..."
if ! gcloud projects describe $PROJECT_ID >/dev/null 2>&1; then
    echo "❌ Cannot access project: $PROJECT_ID"
    echo "Available projects:"
    gcloud projects list
    exit 1
fi

echo "✅ Project access verified"

# Check if required files exist
echo "🔍 Checking required files..."
REQUIRED_FILES=("Dockerfile" "server.js" "package.json")
for file in "${REQUIRED_FILES[@]}"; do
    if [ ! -f "$file" ]; then
        echo "❌ Required file not found: $file"
        exit 1
    fi
done

echo "✅ All required files found"

# Set the project
gcloud config set project $PROJECT_ID

# Enable required APIs
echo "📡 Enabling required APIs..."
gcloud services enable cloudbuild.googleapis.com \
    run.googleapis.com \
    containerregistry.googleapis.com \
    storage.googleapis.com \
    sqladmin.googleapis.com

echo "✅ APIs enabled"

# Create .gcloudignore if it doesn't exist
if [ ! -f ".gcloudignore" ]; then
    echo "📝 Creating .gcloudignore..."
    cat > .gcloudignore << 'EOF'
.git/
.github/
node_modules/
npm-debug.log
.env
.env.*
secrets/
*.log
.DS_Store
README.md
docs/
test/
.vscode/
Thumbs.db
EOF
fi

# Build and submit to Cloud Build
echo "🔨 Building Docker image with video processing support..."
gcloud builds submit --tag $IMAGE_NAME --timeout=20m

echo "✅ Docker image built successfully"

# Check if bucket exists, create if it doesn't
echo "🪣 Checking if storage bucket exists..."
if ! gsutil ls -b gs://$BUCKET_NAME >/dev/null 2>&1; then
    echo "📦 Creating storage bucket: $BUCKET_NAME"
    gsutil mb -p $PROJECT_ID -c STANDARD -l $REGION gs://$BUCKET_NAME
    
    # Set bucket permissions for public access to videos
    gsutil iam ch allUsers:objectViewer gs://$BUCKET_NAME
    echo "✅ Storage bucket created and configured"
else
    echo "✅ Storage bucket already exists"
fi

# Deploy to Cloud Run with enhanced configuration
echo "🚀 Deploying to Cloud Run with enhanced video processing capabilities..."
gcloud run deploy $SERVICE_NAME \
    --image $IMAGE_NAME \
    --platform managed \
    --region $REGION \
    --allow-unauthenticated \
    --port 3000 \
    --memory $MEMORY \
    --cpu $CPU \
    --min-instances $MIN_INSTANCES \
    --max-instances $MAX_INSTANCES \
    --service-account=$SERVICE_ACCOUNT \
    --timeout $TIMEOUT \
    --concurrency 10 \
    --set-env-vars "NODE_ENV=production,GOOGLE_CLOUD_PROJECT_ID=$PROJECT_ID,GOOGLE_CLOUD_BUCKET_NAME=$BUCKET_NAME,ENABLE_TRANSCODING=true,ENABLE_THUMBNAILS=true,ENABLE_ANALYTICS=true,MAX_FILE_SIZE=8589934592,FFMPEG_THREADS=2,RATE_LIMIT_MAX_REQUESTS=100" \
    --add-cloudsql-instances $PROJECT_ID:$REGION:duovr-db \
    --quiet

echo "✅ Cloud Run deployment completed"

# Get the service URL
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --platform managed --region $REGION --format 'value(status.url)')

echo ""
echo "🎉 Enhanced DuoVR Server v2.0 deployment completed successfully!"
echo ""
echo "📊 Deployment Summary:"
echo "  🌐 Service URL: $SERVICE_URL"
echo "  🔍 Health check: $SERVICE_URL/health"
echo "  📱 API Documentation: $SERVICE_URL/"
echo "  💾 Memory: $MEMORY"
echo "  ⚡ CPU: $CPU"
echo "  🪣 Storage bucket: gs://$BUCKET_NAME"
echo "  ⏱️  Timeout: ${TIMEOUT}s"
echo ""
echo "🎬 New Features Available:"
echo "  ✅ Video streaming with range support"
echo "  ✅ Automatic transcoding to multiple qualities"
echo "  ✅ Thumbnail generation"
echo "  ✅ Advanced analytics and monitoring"
echo "  ✅ Enhanced 360° video detection"
echo "  ✅ Session management"
echo ""
echo "🔗 Key Endpoints:"
echo "  📹 Video streaming: $SERVICE_URL/files/{fileName}/stream"
echo "  🎞️  Video metadata: $SERVICE_URL/files/{fileName}/metadata"
echo "  🎬 Video transcoding: $SERVICE_URL/files/{fileName}/transcode"
echo "  🖼️  Thumbnail generation: $SERVICE_URL/files/{fileName}/thumbnail"
echo "  📊 Analytics: $SERVICE_URL/analytics/dashboard"
echo ""

# Test the health endpoint
echo "🏥 Testing health endpoint..."
echo "⏳ Waiting for service to be ready..."
sleep 10

HEALTH_RESPONSE=$(curl -s "$SERVICE_URL/health" || echo "Health check failed")
if echo "$HEALTH_RESPONSE" | grep -q "healthy"; then
    echo "✅ Health check passed!"
    echo "📋 Service features:"
    echo "$HEALTH_RESPONSE" | jq '.features' 2>/dev/null || echo "  (Could not parse features)"
else
    echo "⚠️  Health check response: $HEALTH_RESPONSE"
fi

echo ""
echo "📚 Next Steps:"
echo "  1. Update your Unity URLLoader.cs script with the new service URL"
echo "  2. Test video upload using: curl -X POST -F 'video=@your-video.mp4' $SERVICE_URL/files/upload"
echo "  3. Monitor analytics at: $SERVICE_URL/analytics/dashboard"
echo "  4. Check logs: gcloud logs tail /google.com/cloud/run/job-name=$SERVICE_NAME --limit=50"
echo ""
echo "🎊 Deployment finished successfully!"