#!/bin/bash

# DuoVR Server Deployment Script
set -e

# Configuration - UPDATE THESE VALUES
PROJECT_ID="plated-envoy-463521-d0"  # Leave empty to use current gcloud project, or set your project ID
SERVICE_NAME="duovr-server"
REGION="us-west1"  # Change if you prefer a different region

echo "🚀 Starting deployment of DuoVR Server..."

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

IMAGE_NAME="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

echo "📋 Using project: $PROJECT_ID"
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

# Check if Dockerfile exists
if [ ! -f "Dockerfile" ]; then
    echo "❌ Dockerfile not found in current directory"
    exit 1
fi

echo "✅ Dockerfile found"

# Set the project
gcloud config set project $PROJECT_ID

# Enable required APIs
echo "📡 Enabling required APIs..."
gcloud services enable cloudbuild.googleapis.com
gcloud services enable run.googleapis.com
gcloud services enable containerregistry.googleapis.com

# Build and submit to Cloud Build
echo "🔨 Building Docker image..."
gcloud builds submit --tag $IMAGE_NAME

# Deploy to Cloud Run
echo "🚀 Deploying to Cloud Run..."
gcloud run deploy $SERVICE_NAME \
    --image $IMAGE_NAME \
    --platform managed \
    --region $REGION \
    --allow-unauthenticated \
    --port 3000 \
    --memory 1Gi \
    --cpu 1 \
    --min-instances 0 \
    --max-instances 10 \
    --set-env-vars NODE_ENV=production \
    --timeout 300

# Get the service URL
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --platform managed --region $REGION --format 'value(status.url)')

echo "✅ Deployment complete!"
echo "🌐 Service URL: $SERVICE_URL"
echo "🔍 Health check: $SERVICE_URL/health"

# Test the health endpoint
echo "🏥 Testing health endpoint..."
curl -f "$SERVICE_URL/health" || echo "⚠️  Health check failed"

echo "🎉 Deployment finished successfully!"