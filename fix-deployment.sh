#!/bin/bash

# Fix DuoVR Deployment Issues
set -e

PROJECT_ID="plated-envoy-463521-d0"
ACCOUNT="jr@duovr.com"

echo "🔧 Fixing DuoVR deployment issues..."

# Step 1: Verify authentication
echo "1️⃣ Checking authentication..."
CURRENT_ACCOUNT=$(gcloud config get-value account 2>/dev/null || echo "none")

if [ "$CURRENT_ACCOUNT" != "$ACCOUNT" ]; then
    echo "⚠️ Wrong account. Current: $CURRENT_ACCOUNT, Expected: $ACCOUNT"
    echo "Re-authenticating..."
    gcloud auth login $ACCOUNT
fi

echo "✅ Authenticated as: $(gcloud config get-value account)"

# Step 2: Set and verify project
echo "2️⃣ Setting project..."
gcloud config set project $PROJECT_ID

# Verify project access
if gcloud projects describe $PROJECT_ID >/dev/null 2>&1; then
    echo "✅ Project access verified: $PROJECT_ID"
else
    echo "❌ Cannot access project $PROJECT_ID"
    echo "Available projects for $ACCOUNT:"
    gcloud projects list --format="table(projectId,name)"
    echo ""
    echo "Please check:"
    echo "1. Project ID is correct"
    echo "2. Account has access to the project"
    exit 1
fi

# Step 3: Check and enable APIs
echo "3️⃣ Enabling required APIs..."
REQUIRED_APIS=(
    "cloudbuild.googleapis.com"
    "run.googleapis.com"
    "containerregistry.googleapis.com"
    "storage.googleapis.com"
)

for api in "${REQUIRED_APIS[@]}"; do
    echo "Enabling $api..."
    gcloud services enable $api --project=$PROJECT_ID
done

# Wait for APIs to be ready
echo "⏳ Waiting for APIs to be ready..."
sleep 15

# Step 4: Test API access
echo "4️⃣ Testing API access..."

# Test Cloud Build API
if gcloud builds list --limit=1 --project=$PROJECT_ID >/dev/null 2>&1; then
    echo "✅ Cloud Build API accessible"
else
    echo "❌ Cloud Build API not accessible"
    echo "Checking IAM permissions..."
    
    # Check current user's roles
    echo "Current roles for $ACCOUNT:"
    gcloud projects get-iam-policy $PROJECT_ID \
        --flatten="bindings[].members" \
        --format="table(bindings.role)" \
        --filter="bindings.members:user:$ACCOUNT" || echo "No roles found"
    
    echo ""
    echo "Required roles for deployment:"
    echo "- roles/cloudbuild.builds.builder"
    echo "- roles/run.admin"
    echo "- roles/storage.admin"
    echo "- roles/iam.serviceAccountUser"
    
    exit 1
fi

# Test Container Registry access
if gcloud container images list --repository=gcr.io/$PROJECT_ID >/dev/null 2>&1; then
    echo "✅ Container Registry accessible"
else
    echo "❌ Container Registry not accessible"
    exit 1
fi

# Test Cloud Run access
if gcloud run services list --region=us-west1 --project=$PROJECT_ID >/dev/null 2>&1; then
    echo "✅ Cloud Run accessible"
else
    echo "❌ Cloud Run not accessible"
    exit 1
fi

# Step 5: Check service account
echo "5️⃣ Checking service account..."
SERVICE_ACCOUNT="signedurl-getter@${PROJECT_ID}.iam.gserviceaccount.com"

if gcloud iam service-accounts describe $SERVICE_ACCOUNT --project=$PROJECT_ID >/dev/null 2>&1; then
    echo "✅ Service account exists: $SERVICE_ACCOUNT"
else
    echo "❌ Service account not found: $SERVICE_ACCOUNT"
    echo "Creating service account..."
    
    gcloud iam service-accounts create signedurl-getter \
        --display-name="DuoVR Server Service Account" \
        --description="Service account for DuoVR video server" \
        --project=$PROJECT_ID
    
    echo "✅ Service account created"
fi

# Add required roles to service account
echo "Adding roles to service account..."
REQUIRED_ROLES=(
    "roles/storage.admin"
    "roles/cloudsql.client"
    "roles/run.invoker"
)

for role in "${REQUIRED_ROLES[@]}"; do
    echo "Adding role: $role"
    gcloud projects add-iam-policy-binding $PROJECT_ID \
        --member="serviceAccount:$SERVICE_ACCOUNT" \
        --role="$role" \
        --quiet
done

# Step 6: Check bucket
echo "6️⃣ Checking storage bucket..."
BUCKET_NAME="jr_testing"

if gsutil ls -b gs://$BUCKET_NAME >/dev/null 2>&1; then
    echo "✅ Bucket exists: $BUCKET_NAME"
else
    echo "Creating bucket: $BUCKET_NAME"
    gsutil mb -p $PROJECT_ID -l us-central1 gs://$BUCKET_NAME
    
    # Make bucket publicly readable for video streaming
    gsutil iam ch allUsers:objectViewer gs://$BUCKET_NAME
    echo "✅ Bucket created and configured"
fi

echo ""
echo "🎉 All checks passed! Ready for deployment."
echo ""
echo "Now run your deployment:"
echo "./manual-deploy.sh"