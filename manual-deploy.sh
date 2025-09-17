#!/bin/bash

# DuoVR Server - Main Deployment Script
# Handles Cloud Build issues with multiple fallback methods
set -e

PROJECT_ID="plated-envoy-463521-d0"
SERVICE_NAME="duovr-server"
REGION="us-west1"
SERVICE_ACCOUNT="signedurl-getter@${PROJECT_ID}.iam.gserviceaccount.com"
IMAGE_NAME="gcr.io/$PROJECT_ID/$SERVICE_NAME"
BUCKET_NAME="jr_testing"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}ℹ️  $1${NC}"; }
log_success() { echo -e "${GREEN}✅ $1${NC}"; }
log_error() { echo -e "${RED}❌ $1${NC}"; }
log_warning() { echo -e "${YELLOW}⚠️  $1${NC}"; }

echo "🚀 DuoVR Server - Production Deployment"
echo "======================================="
echo ""
echo "Project: $PROJECT_ID"
echo "Service: $SERVICE_NAME"
echo "Region: $REGION"
echo "Service Account: $SERVICE_ACCOUNT"
echo "Image: $IMAGE_NAME"
echo ""

# Set project
gcloud config set project $PROJECT_ID

# Verify service account exists
log_info "Verifying service account..."
if gcloud iam service-accounts describe $SERVICE_ACCOUNT --project=$PROJECT_ID >/dev/null 2>&1; then
    log_success "Service account verified: $SERVICE_ACCOUNT"
else
    log_error "Service account not found: $SERVICE_ACCOUNT"
    echo ""
    echo "Please run the setup script first:"
    echo "./scripts/fix-all-deployment-issues.sh"
    exit 1
fi

# Ensure service account has required permissions
log_info "Ensuring service account has build permissions..."
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:$SERVICE_ACCOUNT" \
    --role="roles/cloudbuild.builds.builder" \
    --quiet 2>/dev/null || true

gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:$SERVICE_ACCOUNT" \
    --role="roles/storage.admin" \
    --quiet 2>/dev/null || true

# Build the Docker image using multiple methods
BUILD_SUCCESS=false

# Method 1: Standard Cloud Build
log_info "METHOD 1: Standard Cloud Build"
if gcloud builds submit --tag $IMAGE_NAME --project=$PROJECT_ID --timeout=20m 2>/dev/null; then
    log_success "Standard Cloud Build successful!"
    BUILD_SUCCESS=true
else
    log_warning "Standard Cloud Build failed, trying alternative method..."
fi

# Method 2: Cloud Build with custom configuration
if [ "$BUILD_SUCCESS" = false ]; then
    log_info "METHOD 2: Cloud Build with custom configuration"
    
    cat > /tmp/cloudbuild.yaml << EOF
steps:
- name: 'gcr.io/cloud-builders/docker'
  args: ['build', '-t', '$IMAGE_NAME', '.']
images:
- '$IMAGE_NAME'
serviceAccount: 'projects/$PROJECT_ID/serviceAccounts/$SERVICE_ACCOUNT'
timeout: '1200s'
options:
  logging: CLOUD_LOGGING_ONLY
  machineType: 'E2_HIGHCPU_8'
EOF
    
    if gcloud builds submit --config=/tmp/cloudbuild.yaml --project=$PROJECT_ID 2>/dev/null; then
        log_success "Custom Cloud Build configuration successful!"
        BUILD_SUCCESS=true
    else
        log_warning "Custom Cloud Build failed, trying direct Docker method..."
    fi
    
    rm -f /tmp/cloudbuild.yaml
fi

# Method 3: Direct Docker build and push
if [ "$BUILD_SUCCESS" = false ]; then
    log_info "METHOD 3: Direct Docker build and push"
    
    # Check if Docker is available
    if ! command -v docker &> /dev/null; then
        log_error "Docker not found. Please install Docker or fix Cloud Build issues."
        exit 1
    fi
    
    # Configure Docker authentication
    gcloud auth configure-docker gcr.io --quiet
    
    # Build locally
    log_info "Building Docker image locally..."
    docker build -t $IMAGE_NAME .
    
    # Push to registry
    log_info "Pushing to Google Container Registry..."
    docker push $IMAGE_NAME
    
    log_success "Direct Docker build and push successful!"
    BUILD_SUCCESS=true
fi

if [ "$BUILD_SUCCESS" = false ]; then
    log_error "All build methods failed!"
    echo ""
    echo "Troubleshooting steps:"
    echo "1. Run: ./scripts/fix-all-deployment-issues.sh"
    echo "2. Check Docker installation: docker --version"
    echo "3. Check Cloud Build permissions"
    exit 1
fi

# Deploy to Cloud Run
log_info "Deploying to Cloud Run with production configuration..."

gcloud run deploy $SERVICE_NAME \
    --image $IMAGE_NAME \
    --platform managed \
    --region $REGION \
    --allow-unauthenticated \
    --port 3000 \
    --memory 4Gi \
    --cpu 2 \
    --min-instances 0 \
    --max-instances 10 \
    --service-account=$SERVICE_ACCOUNT \
    --timeout 3600 \
    --concurrency 10 \
    --set-env-vars "NODE_ENV=production,GOOGLE_CLOUD_PROJECT_ID=$PROJECT_ID,GOOGLE_CLOUD_BUCKET_NAME=$BUCKET_NAME,ENABLE_TRANSCODING=true,ENABLE_THUMBNAILS=true,ENABLE_ANALYTICS=true,MAX_FILE_SIZE=8589934592,FFMPEG_THREADS=2,RATE_LIMIT_MAX_REQUESTS=100" \
    --project=$PROJECT_ID

# Get service URL
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME \
    --platform managed \
    --region $REGION \
    --project=$PROJECT_ID \
    --format 'value(status.url)')

echo ""
echo "🎉 Deployment Complete!"
echo "======================"
echo ""
log_success "Image built and deployed successfully"
log_success "Service account: $SERVICE_ACCOUNT"
log_success "Service URL: $SERVICE_URL"
echo ""
echo "🧪 Quick Test:"
echo "curl $SERVICE_URL/health"
echo ""
echo "📝 Next Steps:"
echo "1. Test health endpoint above"
echo "2. Verify storage bucket exists: gs://$BUCKET_NAME"  
echo "3. Update Unity URLLoader.cs with: $SERVICE_URL"
echo "4. Run comprehensive tests: ./scripts/test-duovr-server.sh"
echo ""

# Optional: Quick health check
log_info "Running quick health check..."
if curl -f -s "$SERVICE_URL/health" > /dev/null; then
    log_success "Health check passed! Service is ready."
else
    log_warning "Health check failed - service may still be starting up"
    echo "Wait 1-2 minutes and try: curl $SERVICE_URL/health"
fi

echo ""
log_success "Deployment script completed successfully!"