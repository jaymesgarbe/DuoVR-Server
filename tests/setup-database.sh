#!/bin/bash

# Cloud SQL Setup for DuoVR Server

# NOT CURRENTLY IN USE

# set -e

# PROJECT_ID="plated-envoy-463521-d0"
# INSTANCE_NAME="duovr-db"
# REGION="us-central1"
# DATABASE_NAME="duovr_db"
# DB_USER="duovr_user"

# echo "🗄️ Setting up Cloud SQL for DuoVR Server..."

# # Enable Cloud SQL API
# gcloud services enable sqladmin.googleapis.com

# # Create PostgreSQL instance
# echo "📊 Creating PostgreSQL instance..."
# gcloud sql instances create $INSTANCE_NAME \
#     --database-version=POSTGRES_15 \
#     --tier=db-f1-micro \
#     --region=$REGION \
#     --storage-size=10GB \
#     --storage-type=SSD

# # Create database
# echo "📋 Creating database..."
# gcloud sql databases create $DATABASE_NAME \
#     --instance=$INSTANCE_NAME

# # Generate password
# DB_PASSWORD=$(openssl rand -base64 24)

# # Create user
# echo "👤 Creating database user..."
# gcloud sql users create $DB_USER \
#     --instance=$INSTANCE_NAME \
#     --password=$DB_PASSWORD

# # Get connection name
# CONNECTION_NAME=$(gcloud sql instances describe $INSTANCE_NAME \
#     --format='value(connectionName)')

# echo ""
# echo "✅ Database setup complete!"
# echo ""
# echo "📝 Update your .env file with these values:"
# echo "DB_HOST=/cloudsql/$CONNECTION_NAME"
# echo "DB_NAME=$DATABASE_NAME"
# echo "DB_USER=$DB_USER"
# echo "DB_PASSWORD=$DB_PASSWORD"
# echo "DB_SOCKET_PATH=/cloudsql/$CONNECTION_NAME"
# echo ""
# echo "🔧 Update your Cloud Run deployment to include:"
# echo "--add-cloudsql-instances $CONNECTION_NAME"