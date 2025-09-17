#!/bin/bash

# Check and fix service account setup
PROJECT_ID="plated-envoy-463521-d0"
SERVICE_ACCOUNT="signedurl-getter@${PROJECT_ID}.iam.gserviceaccount.com"

echo "🔍 Checking service account: $SERVICE_ACCOUNT"

# Check if service account exists
if gcloud iam service-accounts describe $SERVICE_ACCOUNT >/dev/null 2>&1; then
    echo "✅ Service account exists"
else
    echo "❌ Service account not found. Creating..."
    
    # Extract name from email
    SA_NAME=$(echo $SERVICE_ACCOUNT | cut -d'@' -f1)
    
    gcloud iam service-accounts create $SA_NAME \
        --description="Service account for DuoVR Server" \
        --display-name="DuoVR Server Service Account"
fi

# Check/add required roles
echo "🔐 Checking IAM roles..."

REQUIRED_ROLES=(
    "roles/storage.admin"
    "roles/cloudsql.client"
)

for role in "${REQUIRED_ROLES[@]}"; do
    if gcloud projects get-iam-policy $PROJECT_ID \
        --flatten="bindings[].members" \
        --format="table(bindings.role)" \
        --filter="bindings.members:serviceAccount:$SERVICE_ACCOUNT AND bindings.role:$role" | grep -q "$role"; then
        echo "✅ Role $role already assigned"
    else
        echo "➕ Adding role $role"
        gcloud projects add-iam-policy-binding $PROJECT_ID \
            --member="serviceAccount:$SERVICE_ACCOUNT" \
            --role="$role"
    fi
done

# Check bucket access
BUCKET_NAME="duovr-files-bucket"
echo "🪣 Checking bucket access..."

if gsutil ls gs://$BUCKET_NAME >/dev/null 2>&1; then
    echo "✅ Bucket $BUCKET_NAME accessible"
else
    echo "❌ Cannot access bucket $BUCKET_NAME"
    echo "Creating bucket..."
    gsutil mb -p $PROJECT_ID gs://$BUCKET_NAME
fi

echo ""
echo "✅ Service account check complete!"
echo ""
echo "🚀 Ready to deploy with:"
echo "./manual-deploy.sh"