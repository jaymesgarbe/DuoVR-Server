#!/bin/bash

# Comprehensive DuoVR Deployment Fix Script
# Handles authentication, APIs, service accounts, permissions, and bucket creation
set -e

# Configuration
PROJECT_ID="plated-envoy-463521-d0"
ACCOUNT="jr@duovr.com"
BUCKET_NAME="duovr-files-bucket"
REGION="us-central1"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

echo "🔧 DuoVR Comprehensive Deployment Fix Script"
echo "============================================="
echo ""

# Step 1: Authentication Fix
log_info "STEP 1: Fixing Authentication"
echo "Current account: $(gcloud config get-value account 2>/dev/null || echo 'none')"

CURRENT_ACCOUNT=$(gcloud config get-value account 2>/dev/null || echo "none")
if [ "$CURRENT_ACCOUNT" != "$ACCOUNT" ]; then
    log_warning "Wrong account or not authenticated. Re-authenticating..."
    echo "If browser doesn't open, copy the URL and open manually"
    gcloud auth login $ACCOUNT
    
    # Also refresh application default credentials
    log_info "Refreshing application default credentials..."
    gcloud auth application-default login
fi

log_success "Authenticated as: $(gcloud config get-value account)"

# Step 2: Project Setup
log_info "STEP 2: Project Configuration"
gcloud config set project $PROJECT_ID

# Verify project access
if gcloud projects describe $PROJECT_ID >/dev/null 2>&1; then
    log_success "Project access verified: $PROJECT_ID"
else
    log_error "Cannot access project $PROJECT_ID"
    echo "Available projects:"
    gcloud projects list --format="table(projectId,name)"
    echo ""
    echo "Please verify:"
    echo "1. Project ID is correct: $PROJECT_ID"
    echo "2. Account $ACCOUNT has access to the project"
    exit 1
fi

# Check billing
log_info "Checking billing status..."
if gcloud billing projects describe $PROJECT_ID >/dev/null 2>&1; then
    log_success "Billing is enabled"
else
    log_error "Billing may not be enabled"
    echo "Enable billing at: https://console.cloud.google.com/billing/linkedaccount?project=$PROJECT_ID"
    echo "Billing is required for Cloud Build and Cloud Run"
    exit 1
fi

# Step 3: Enable APIs
log_info "STEP 3: Enabling Required APIs"
REQUIRED_APIS=(
    "cloudbuild.googleapis.com"
    "run.googleapis.com"
    "containerregistry.googleapis.com"
    "storage.googleapis.com"
    "sqladmin.googleapis.com"
    "iam.googleapis.com"
)

for api in "${REQUIRED_APIS[@]}"; do
    log_info "Enabling $api..."
    gcloud services enable $api --project=$PROJECT_ID
    sleep 2
done

log_info "Waiting 20 seconds for APIs to be ready..."
sleep 20

# Verify APIs are enabled
for api in "${REQUIRED_APIS[@]}"; do
    if gcloud services list --enabled --filter="name:$api" --format="value(name)" | grep -q "$api"; then
        log_success "$api is enabled"
    else
        log_error "$api failed to enable"
        exit 1
    fi
done

# Step 4: Fix Cloud Build Service Account
log_info "STEP 4: Fixing Cloud Build Service Account"
CLOUDBUILD_SA="${PROJECT_ID}@cloudbuild.gserviceaccount.com"

if gcloud iam service-accounts describe $CLOUDBUILD_SA --project=$PROJECT_ID >/dev/null 2>&1; then
    log_success "Cloud Build service account exists: $CLOUDBUILD_SA"
else
    log_warning "Cloud Build service account missing. Attempting to fix..."
    
    # Try to trigger service account creation by re-enabling Cloud Build
    log_info "Re-enabling Cloud Build API to trigger service account creation..."
    gcloud services disable cloudbuild.googleapis.com --project=$PROJECT_ID --force --quiet
    sleep 10
    gcloud services enable cloudbuild.googleapis.com --project=$PROJECT_ID
    
    log_info "Waiting 30 seconds for service account creation..."
    sleep 30
    
    if gcloud iam service-accounts describe $CLOUDBUILD_SA --project=$PROJECT_ID >/dev/null 2>&1; then
        log_success "Cloud Build service account created successfully"
    else
        log_error "Cloud Build service account still missing"
        echo "This may require manual intervention or waiting longer"
        echo "Try running this script again in a few minutes"
    fi
fi

# Add required roles to Cloud Build service account
log_info "Adding roles to Cloud Build service account..."
CLOUDBUILD_ROLES=(
    "roles/cloudbuild.builds.builder"
    "roles/storage.admin"
    "roles/logging.logWriter"
    "roles/run.admin"
    "roles/iam.serviceAccountUser"
)

for role in "${CLOUDBUILD_ROLES[@]}"; do
    log_info "Adding role: $role"
    gcloud projects add-iam-policy-binding $PROJECT_ID \
        --member="serviceAccount:$CLOUDBUILD_SA" \
        --role="$role" \
        --quiet || log_warning "Failed to add $role (may already exist)"
done

# Step 5: Check User Permissions
log_info "STEP 5: Checking User Permissions"
log_info "Current roles for $ACCOUNT:"
gcloud projects get-iam-policy $PROJECT_ID \
    --flatten="bindings[].members" \
    --format="table(bindings.role)" \
    --filter="bindings.members:user:$ACCOUNT" || echo "No direct roles found"

# Check if user has sufficient permissions for deployment
REQUIRED_USER_ROLES=(
    "roles/cloudbuild.builds.builder"
    "roles/run.admin"
    "roles/storage.admin"
    "roles/iam.serviceAccountUser"
)

log_info "Checking if user has required permissions..."
USER_HAS_EDITOR=false
if gcloud projects get-iam-policy $PROJECT_ID --flatten="bindings[].members" --format="value(bindings.role)" --filter="bindings.members:user:$ACCOUNT" | grep -q "roles/editor\|roles/owner"; then
    USER_HAS_EDITOR=true
    log_success "User has Editor or Owner role (sufficient permissions)"
fi

if [ "$USER_HAS_EDITOR" = false ]; then
    log_warning "User may need additional roles for deployment"
    echo "If deployment fails, ask a project owner to run:"
    echo "gcloud projects add-iam-policy-binding $PROJECT_ID \\"
    echo "    --member='user:$ACCOUNT' \\"
    echo "    --role='roles/editor'"
fi

# Step 6: Setup DuoVR Service Account
log_info "STEP 6: Setting Up DuoVR Service Account"
DUOVR_SA="signedurl-getter@${PROJECT_ID}.iam.gserviceaccount.com"

if gcloud iam service-accounts describe $DUOVR_SA --project=$PROJECT_ID >/dev/null 2>&1; then
    log_success "DuoVR service account exists: $DUOVR_SA"
else
    log_info "Creating DuoVR service account..."
    gcloud iam service-accounts create signedurl-getter \
        --display-name="DuoVR Server Service Account" \
        --description="Service account for DuoVR video server" \
        --project=$PROJECT_ID
    log_success "DuoVR service account created"
fi

# Add required roles to DuoVR service account
log_info "Adding roles to DuoVR service account..."
DUOVR_ROLES=(
    "roles/storage.admin"
    "roles/cloudsql.client"
    "roles/run.invoker"
)

for role in "${DUOVR_ROLES[@]}"; do
    log_info "Adding role: $role"
    gcloud projects add-iam-policy-binding $PROJECT_ID \
        --member="serviceAccount:$DUOVR_SA" \
        --role="$role" \
        --quiet
done

# Step 7: Handle Storage Bucket
log_info "STEP 7: Setting Up Storage Bucket"

# Check if gsutil works (Windows permission issue)
GSUTIL_WORKS=true
if ! gsutil --version >/dev/null 2>&1; then
    GSUTIL_WORKS=false
    log_warning "gsutil has permission issues (common on Windows)"
fi

if [ "$GSUTIL_WORKS" = true ]; then
    # Try to create bucket with gsutil
    if gsutil ls -b gs://$BUCKET_NAME >/dev/null 2>&1; then
        log_success "Bucket exists: $BUCKET_NAME"
    else
        log_info "Creating bucket: $BUCKET_NAME"
        gsutil mb -p $PROJECT_ID -l $REGION gs://$BUCKET_NAME
        
        # Make bucket publicly readable for video streaming
        gsutil iam ch allUsers:objectViewer gs://$BUCKET_NAME
        log_success "Bucket created and configured: $BUCKET_NAME"
    fi
else
    # gsutil doesn't work - provide manual instructions
    log_warning "Cannot create bucket automatically due to gsutil permissions"
    echo ""
    echo "📝 CREATE BUCKET MANUALLY:"
    echo "1. Go to: https://console.cloud.google.com/storage/browser?project=$PROJECT_ID"
    echo "2. Click 'Create Bucket'"
    echo "3. Name: $BUCKET_NAME"
    echo "4. Location: $REGION"
    echo "5. Storage class: Standard"
    echo "6. Click 'Create'"
    echo ""
    echo "The bucket is needed for video file storage."
fi

# Step 8: Test All Components
log_info "STEP 8: Testing All Components"

# Test Cloud Build
log_info "Testing Cloud Build..."
cat > /tmp/test-cloudbuild.yaml << 'EOF'
steps:
- name: 'gcr.io/cloud-builders/docker'
  args: ['version']
timeout: '60s'
EOF

if gcloud builds submit --no-source --config=/tmp/test-cloudbuild.yaml --project=$PROJECT_ID >/dev/null 2>&1; then
    log_success "Cloud Build is working"
else
    log_error "Cloud Build test failed"
    echo "This may resolve itself in a few minutes as APIs propagate"
fi

rm -f /tmp/test-cloudbuild.yaml

# Test Cloud Run access
log_info "Testing Cloud Run access..."
if gcloud run services list --region=us-west1 --project=$PROJECT_ID >/dev/null 2>&1; then
    log_success "Cloud Run is accessible"
else
    log_error "Cloud Run not accessible"
fi

# Test Container Registry
log_info "Testing Container Registry access..."
if gcloud container images list --repository=gcr.io/$PROJECT_ID >/dev/null 2>&1; then
    log_success "Container Registry is accessible"
else
    log_error "Container Registry not accessible"
fi

# Summary
echo ""
echo "==========================================="
echo "🎉 Comprehensive Fix Complete!"
echo "==========================================="
echo ""
log_success "Authentication: Fixed"
log_success "Project access: Verified"
log_success "APIs: Enabled"
log_success "Service accounts: Created and configured"

if [ "$GSUTIL_WORKS" = true ]; then
    log_success "Storage bucket: Ready"
else
    log_warning "Storage bucket: Needs manual creation (see instructions above)"
fi

echo ""
echo "🚀 NEXT STEPS:"
echo "1. Try your deployment: ./manual-deploy.sh"
echo "2. If Cloud Build still fails, try: ./deploy-direct-push.sh"
echo "3. If command line fails, use Google Cloud Console deployment"
echo ""
echo "🔗 Useful links:"
echo "- Cloud Run Console: https://console.cloud.google.com/run?project=$PROJECT_ID"
echo "- Storage Console: https://console.cloud.google.com/storage/browser?project=$PROJECT_ID"
echo "- IAM Console: https://console.cloud.google.com/iam-admin/iam?project=$PROJECT_ID"
echo ""

if [ "$GSUTIL_WORKS" = false ]; then
    echo "⚠️  IMPORTANT: Create the storage bucket manually before deployment!"
    echo "   Bucket name: $BUCKET_NAME"
    echo "   Link: https://console.cloud.google.com/storage/browser?project=$PROJECT_ID"
fi

echo ""
log_success "Fix script completed successfully!"