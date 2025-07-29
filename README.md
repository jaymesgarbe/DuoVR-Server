# Replace your server.js with this complete version, then:
docker build -t gcr.io/plated-envoy-463521-d0/duovr-server:latest .
docker push gcr.io/plated-envoy-463521-d0/duovr-server:latest

gcloud run deploy duovr-server \
    --image gcr.io/plated-envoy-463521-d0/duovr-server:latest \
    --platform managed \
    --region us-west1 \
    --allow-unauthenticated \
    --port 3000 \
    --memory 32Gi \
    --cpu 8 \
    --service-account=signedurl-getter@plated-envoy-463521-d0.iam.gserviceaccount.com \
    --project plated-envoy-463521-d0 \
    --set-env-vars="NODE_ENV=production,GOOGLE_CLOUD_PROJECT_ID=plated-envoy-463521-d0,GOOGLE_CLOUD_BUCKET_NAME=duovr-files-bucket,DB_HOST=" \
    --timeout=3600 \
    --quiet