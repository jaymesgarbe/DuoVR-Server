DuoVR-Server
A Node.js server that integrates with Google Cloud Storage buckets and Google Cloud SQL using service account authentication. Features include signed URL generation for secure file access and comprehensive file management.
Features

🔐 Service account authentication with Google Cloud
📦 Google Cloud Storage integration with signed URLs
🗄️ Google Cloud SQL database connectivity
🚀 RESTful API for file operations
📊 File metadata management
🛡️ Security features (CORS, Helmet, Rate limiting)
📤 File upload/download capabilities
🔄 Bulk operations support

Prerequisites

Google Cloud Platform Account
Node.js 18+
Google Cloud Storage bucket
Google Cloud SQL instance
Service Account with appropriate permissions

Google Cloud Setup
1. Create a Service Account
bash# Using gcloud CLI
gcloud iam service-accounts create duovr-service-account \
    --description="Service account for DuoVR server" \
    --display-name="DuoVR Service Account"
2. Grant Required Permissions
bash# Storage permissions
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
    --member="serviceAccount:duovr-service-account@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/storage.admin"

# Cloud SQL permissions
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
    --member="serviceAccount:duovr-service-account@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/cloudsql.client"
3. Create and Download Service Account Key
bashgcloud iam service-accounts keys create ./service-account-key.json \
    --iam-account=duovr-service-account@YOUR_PROJECT_ID.iam.gserviceaccount.com
4. Create Storage Bucket
bashgsutil mb -p YOUR_PROJECT_ID -c STANDARD -l us-central1 gs://your-bucket-name
5. Set up Cloud SQL Instance
bashgcloud sql instances create duovr-instance \
    --database-version=POSTGRES_14 \
    --tier=db-f1-micro \
    --region=us-central1

gcloud sql databases create duovr_db --instance=duovr-instance
gcloud sql users create duovr_user --instance=duovr-instance --password=secure_password
Installation
1. Clone and Install Dependencies
bashgit clone <your-repo-url>
cd DuoVR-Server
npm install
2. Environment Configuration
bashcp .env.example .env
# Edit .env with your specific configuration
3. Place Service Account Key
bash# Place your service-account-key.json in the project root
# Ensure the path in .env matches the key location
Configuration
Required Environment Variables
env# Server
PORT=3000
NODE_ENV=development

# Google Cloud
GOOGLE_APPLICATION_CREDENTIALS=./service-account-key.json
GOOGLE_CLOUD_PROJECT_ID=your-project-id
GOOGLE_CLOUD_BUCKET_NAME=your-bucket-name

# Database
DB_HOST=your-db-host
DB_NAME=your-database-name
DB_USER=your-db-username
DB_PASSWORD=your-db-password
Running the Server
Development
bashnpm run dev
Production
bashnpm start
Docker
bash# Build and run with Docker Compose
docker-compose up --build

# Or run individual services
docker-compose up duovr-server
docker-compose up postgres
API Endpoints
File Operations
MethodEndpointDescriptionGET/healthHealth checkGET/files/:fileName/signed-urlGenerate signed URLPOST/files/uploadUpload file to bucketGET/filesList files in bucketDELETE/files/:fileNameDelete filePOST/files/bulk-signed-urlsGenerate multiple signed URLs
Database Operations
MethodEndpointDescriptionGET/db/filesGet all file metadataGET/db/files/:idGet specific file metadata
Example Usage
Generate Signed URL
bashcurl "http://localhost:3000/files/example.jpg/signed-url?expiresInMinutes=30&action=read"
Upload File
bashcurl -X POST -F "file=@/path/to/file.jpg" http://localhost:3000/files/upload
Bulk Signed URLs
bashcurl -X POST http://localhost:3000/files/bulk-signed-urls \
  -H "Content-Type: application/json" \
  -d '{"fileNames": ["file1.jpg", "file2.pdf"], "expiresInMinutes": 60}'
Security Features

Helmet: Security headers
CORS: Cross-origin resource sharing
Rate Limiting: Request throttling
Input Validation: Request sanitization
Service Account: Secure GCP authentication

Database Schema
The server uses Sequelize ORM with the following model:
javascriptFileMetadata {
  id: UUID (Primary Key)
  fileName: String
  bucketName: String
  filePath: String
  fileSize: Integer
  mimeType: String
  uploadedAt: Date
  userId: String (Optional)
}
Monitoring & Logging

Health check endpoint at /health
Console logging for all operations
Error handling middleware
Database connection testing

Development
Testing
bashnpm test
Linting
bashnpm run lint
npm run lint:fix
Troubleshooting
Common Issues

Service Account Authentication

Ensure GOOGLE_APPLICATION_CREDENTIALS points to valid JSON key
Verify service account has required permissions


Database Connection

Check Cloud SQL instance is running
Verify connection parameters in .env
For Cloud SQL Proxy, ensure correct instance connection name


Storage Access

Confirm bucket exists and is accessible
Check service account has Storage Admin role



Cloud SQL Proxy (Development)
bash# Download and run Cloud SQL Proxy
./cloud_sql_proxy -instances=YOUR_PROJECT:REGION:INSTANCE=tcp:5432
Debug Mode
bashNODE_ENV=development npm run dev
Deployment
Google Cloud Run
bash# Build and deploy
gcloud run deploy duovr-server \
    --source . \
    --platform managed \
    --region us-central1 \
    --allow-unauthenticated
App Engine
yaml# app.yaml
runtime: nodejs18
env_variables:
  GOOGLE_CLOUD_PROJECT_ID: your-project-id
  GOOGLE_CLOUD_BUCKET_NAME: your-bucket-name
Contributing

Fork the repository
Create a feature branch
Make your changes
Add tests
Submit a pull request

License
MIT License - see LICENSE file for details