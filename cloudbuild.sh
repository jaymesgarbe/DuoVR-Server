#!/bin/bash

# Configure Existing Service Account for Cloud Build
set -e

PROJECT_ID="plated-envoy-463521-d0"
EXISTING_SA="signedurl-getter@${PROJECT_ID}.iam.gserviceaccount.com"

echo "🔧 Configuring Existing Service Account for Cloud Build"
echo "====================================================="
echo ""
echo "Using service account: $EXISTING_SA"

# Step 1: Verify service account exists
if gcloud iam service-accounts describe $EXISTING_SA --project=$PROJECT_ID >/dev/null 2>&1; then
    echo "✅ Service account exists and is accessible"
else
    echo "❌ Service account not found or not accessible: $EXISTING_SA"
    exit 1
fi

# Step 2: Add Cloud Build roles to existing service account
echo "🔐 Adding Cloud Build roles to existing service account..."

CLOUDBUILD_ROLES=(
    "roles/cloudbuild.builds.builder"
    "roles/source.reader"
    "roles/containeranalysis.admin"
    "roles/logging.logWriter"
)

# Add new roles while keeping existing ones
for role in "${CLOUDBUILD_ROLES[@]}"; do
    echo "Adding role: $role"
    gcloud projects add-iam-policy-binding $PROJECT_ID \
        --member="serviceAccount:$EXISTING_SA" \
        --role="$role" \
        --quiet
done

echo "✅ Cloud Build roles added"

# Step 3: Show all current roles for the service account
echo ""
echo "📋 Current roles for $EXISTING_SA:"
gcloud projects get-iam-policy $PROJECT_ID \
    --flatten="bindings[].members" \
    --format="table(bindings.role)" \
    --filter="bindings.members:serviceAccount:$EXISTING_SA"

# Step 4: Test Cloud Build with custom service account
echo ""
echo "🧪 Testing Cloud Build with your existing service account..."

cat > /tmp/test-existing-sa.yaml << 'EOF'
steps:
- name: 'gcr.io/cloud-builders/docker'
  args: ['version']
- name: 'gcr.io/cloud-builders/gcloud' 
  args: ['version']
timeout: '300s'
options:
  logging: CLOUD_LOGGING_ONLY
EOF

echo "Running test build with custom service account..."
if gcloud builds submit \
    --no-source \
    --config=/tmp/test-existing-sa.yaml \
    --service-account=$EXISTING_SA \
    --project=$PROJECT_ID; then
    
    echo ""
    echo "🎉 SUCCESS! Your existing service account works with Cloud Build!"
    
else
    echo ""
    echo "❌ Test failed. Let's check what might be missing..."
    
    # Check if service account has necessary permissions
    echo "Checking service account permissions..."
    gcloud iam service-accounts get-iam-policy $EXISTING_SA --project=$PROJECT_ID || echo "Cannot get SA policy"
fi

rm -f /tmp/test-existing-sa.yaml

echo ""
echo "✅ Service account configuration complete!"
echo ""
echo "🚀 Now you can deploy using your existing service account!"