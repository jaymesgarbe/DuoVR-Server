#!/bin/bash

# DuoVR Server Comprehensive Test Suite (Complete)

# Configuration
SERVER_URL=""
TEST_VIDEO_FILE=""
SESSION_ID=""

# Test results tracking
TESTS_PASSED=0
TESTS_FAILED=0
TOTAL_TESTS=0

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
    # Don't increment here - let run_test handle it
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
    # Don't increment here - let run_test handle it
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

run_test() {
    local test_name="$1"
    local test_command="$2"
    
    ((TOTAL_TESTS++))
    log_info "Running: $test_name"
    
    if eval "$test_command"; then
        echo -e "${GREEN}✅ $test_name${NC}"
        ((TESTS_PASSED++))
        return 0
    else
        echo -e "${RED}❌ $test_name${NC}"
        ((TESTS_FAILED++))
        return 1
    fi
}

# Get server URL
get_server_url() {
    if [ -z "$SERVER_URL" ]; then
        # Try to get from gcloud
        if command -v gcloud &> /dev/null; then
            log_info "Attempting to get server URL from gcloud..."
            SERVER_URL=$(gcloud run services describe duovr-server \
                --platform managed --region us-west1 \
                --format 'value(status.url)' 2>/dev/null || echo "")
                
            if [ -n "$SERVER_URL" ]; then
                log_success "Found server URL: $SERVER_URL"
            fi
        fi
        
        # If still empty, ask user
        if [ -z "$SERVER_URL" ]; then
            echo ""
            echo "Enter your DuoVR server URL (e.g., https://duovr-server-xyz.run.app):"
            echo "You can get this with: gcloud run services describe duovr-server --platform managed --region us-west1 --format 'value(status.url)'"
            read -r SERVER_URL
        fi
    fi
    
    if [ -z "$SERVER_URL" ]; then
        log_error "Server URL is required"
        exit 1
    fi
    
    log_info "Testing server: $SERVER_URL"
}

# Test functions
test_health_check() {
    local response
    if response=$(curl -s --max-time 10 "$SERVER_URL/health" 2>/dev/null); then
        if echo "$response" | grep -q "healthy"; then
            log_info "Health response: ${response:0:100}..."
            return 0
        else
            log_warning "Health check returned unexpected response: ${response:0:50}..."
            return 1
        fi
    else
        log_error "Health check request failed"
        return 1
    fi
}

test_api_info() {
    local response
    if response=$(curl -s --max-time 10 "$SERVER_URL/" 2>/dev/null); then
        if echo "$response" | grep -q "endpoints"; then
            return 0
        else
            log_warning "API info returned unexpected response"
            return 1
        fi
    else
        return 1
    fi
}

test_file_listing() {
    local response
    if response=$(curl -s --max-time 10 "$SERVER_URL/files" 2>/dev/null); then
        if echo "$response" | grep -q "files"; then
            log_info "Files endpoint working"
            return 0
        else
            log_warning "Files endpoint returned unexpected response"
            return 1
        fi
    else
        return 1
    fi
}

test_storage_bucket_check() {
    log_info "Checking if storage bucket exists..."
    
    if command -v gsutil &> /dev/null; then
        if gsutil ls -b gs://duovr-files-bucket >/dev/null 2>&1; then
            log_info "Storage bucket 'duovr-files-bucket' exists"
            return 0
        else
            log_warning "Storage bucket 'duovr-files-bucket' does not exist"
            log_info "Create it with: gsutil mb gs://duovr-files-bucket"
            return 1
        fi
    else
        log_info "gsutil not available, skipping bucket check"
        return 0
    fi
}

test_cors() {
    local response_code
    if response_code=$(curl -s -w "%{http_code}" -H "Origin: http://localhost:3000" \
        -H "Access-Control-Request-Method: POST" \
        -H "Access-Control-Request-Headers: Content-Type" \
        -X OPTIONS "$SERVER_URL/files" 2>/dev/null | tail -c 3); then
        
        if [ "$response_code" = "204" ] || [ "$response_code" = "200" ]; then
            log_info "CORS preflight check passed"
            return 0
        else
            log_warning "CORS check returned HTTP $response_code"
            return 1
        fi
    else
        return 1
    fi
}

test_session_creation() {
    local response
    if response=$(curl -s --max-time 10 -X POST "$SERVER_URL/sessions/create" \
        -H "Content-Type: application/json" \
        -d '{"userId":"test-user","deviceType":"vr","platform":"unity"}' 2>/dev/null); then
        
        if echo "$response" | grep -q "sessionId"; then
            SESSION_ID=$(echo "$response" | grep -o '"sessionId":"[^"]*"' | cut -d'"' -f4)
            if [ -n "$SESSION_ID" ]; then
                log_info "Session created: ${SESSION_ID:0:20}..."
                return 0
            fi
        fi
        log_warning "Session creation returned unexpected response"
        return 1
    else
        return 1
    fi
}

test_signed_url_generation() {
    local test_filename="360-videos/test-video.mp4"
    local response_code
    
    if response_code=$(curl -s -w "%{http_code}" \
        "$SERVER_URL/files/${test_filename}/signed-url?expiresInMinutes=60" 2>/dev/null | tail -c 3); then
        
        if [ "$response_code" = "404" ]; then
            log_info "Signed URL test: File not found (expected for non-existent file)"
            return 0
        elif [ "$response_code" = "200" ]; then
            log_info "Signed URL generated successfully"
            return 0
        else
            log_warning "Signed URL test returned HTTP $response_code"
            return 1
        fi
    else
        return 1
    fi
}

test_upload_url_generation() {
    local response
    local http_code
    
    # Get detailed response with HTTP code
    local full_response
    full_response=$(curl -s -w "\nHTTP_CODE:%{http_code}" --max-time 10 \
        -X POST "$SERVER_URL/files/generate-upload-url" \
        -H "Content-Type: application/json" \
        -d '{"fileName":"test-upload.mp4","fileType":"video/mp4","fileSize":1000000}' 2>/dev/null)
    
    if [ $? -eq 0 ]; then
        response=$(echo "$full_response" | sed '$d')  # Remove last line (HTTP_CODE)
        http_code=$(echo "$full_response" | grep "HTTP_CODE:" | cut -d: -f2)
        
        log_info "HTTP Status: $http_code"
        
        if [ "$http_code" = "200" ]; then
            if echo "$response" | grep -q "uploadUrl"; then
                log_info "Upload URL generated successfully"
                return 0
            else
                log_warning "Upload URL generation: No uploadUrl in response"
                log_info "Response preview: ${response:0:100}..."
                return 1
            fi
        elif [ "$http_code" = "400" ]; then
            log_warning "Upload URL generation: Bad Request (400)"
            log_info "Response: ${response:0:150}..."
            return 1
        elif [ "$http_code" = "500" ]; then
            log_warning "Upload URL generation: Server Error (500)"
            log_info "Response: ${response:0:150}..."
            # Try to get recent logs
            log_info "Checking for server errors..."
            if command -v gcloud &> /dev/null; then
                gcloud logs read /google.com/cloud/run/job-name=duovr-server \
                    --limit=3 \
                    --format="value(textPayload)" \
                    --project=plated-envoy-463521-d0 2>/dev/null | head -n 3 || echo "Cannot access logs"
            fi
            return 1
        else
            log_warning "Upload URL generation: HTTP $http_code"
            log_info "Response: ${response:0:150}..."
            return 1
        fi
    else
        log_error "Upload URL generation: Request failed (timeout or network error)"
        return 1
    fi
}

test_analytics_tracking() {
    if [ -z "$SESSION_ID" ]; then
        log_info "Skipping analytics test (no session ID)"
        return 0
    fi
    
    local response_code
    if response_code=$(curl -s -w "%{http_code}" -X POST "$SERVER_URL/analytics/track" \
        -H "Content-Type: application/json" \
        -d "{\"fileId\":\"test-file-id\",\"sessionId\":\"$SESSION_ID\",\"eventType\":\"view_start\",\"videoTime\":0}" \
        2>/dev/null | tail -c 3); then
        
        if [ "$response_code" = "200" ]; then
            log_info "Analytics tracking successful"
            return 0
        elif [ "$response_code" = "503" ]; then
            log_info "Analytics not available (expected without database)"
            return 0
        else
            log_warning "Analytics tracking returned HTTP $response_code"
            return 1
        fi
    else
        return 1
    fi
}

test_error_handling() {
    local response_code
    if response_code=$(curl -s -w "%{http_code}" "$SERVER_URL/invalid-endpoint" 2>/dev/null | tail -c 3); then
        if [ "$response_code" = "404" ]; then
            log_info "Error handling working (404 for invalid endpoint)"
            return 0
        else
            log_warning "Error handling returned HTTP $response_code instead of 404"
            return 1
        fi
    else
        return 1
    fi
}

test_detailed_server_info() {
    log_info "Getting detailed server information..."
    
    local health_response
    if health_response=$(curl -s --max-time 10 "$SERVER_URL/health" 2>/dev/null); then
        echo ""
        echo "📊 Server Health Details:"
        echo "$health_response"
        echo ""
        return 0
    else
        log_warning "Could not get detailed server info"
        return 1
    fi
}

# Main test execution
main() {
    echo "🚀 DuoVR Server Comprehensive Test Suite"
    echo "========================================"
    
    # Get server URL
    get_server_url
    
    echo ""
    echo "Starting tests..."
    echo ""
    
    # Run tests
    run_test "Health Check" "test_health_check"
    run_test "API Info Endpoint" "test_api_info" 
    run_test "File Listing" "test_file_listing"
    run_test "Storage Bucket Check" "test_storage_bucket_check"
    run_test "CORS Configuration" "test_cors"
    run_test "Session Creation" "test_session_creation"
    run_test "Signed URL Generation" "test_signed_url_generation"
    run_test "Upload URL Generation" "test_upload_url_generation"
    run_test "Analytics Tracking" "test_analytics_tracking"
    run_test "Error Handling" "test_error_handling"
    run_test "Detailed Server Info" "test_detailed_server_info"
    
    # Summary
    echo ""
    echo "========================================"
    echo "Test Results Summary"
    echo "========================================"
    echo "Total Tests: $TOTAL_TESTS"
    echo "Passed: $TESTS_PASSED"  
    echo "Failed: $TESTS_FAILED"
    
    if [ "$TESTS_FAILED" -eq 0 ]; then
        log_success "All tests passed! 🎉"
        echo ""
        echo "Your DuoVR server is ready for production use!"
        echo ""
        echo "Next steps:"
        echo "1. Update Unity URLLoader.cs with: $SERVER_URL"
        echo "2. Test video upload and playback from Unity"
        echo "3. Monitor logs: gcloud logs tail /google.com/cloud/run/job-name=duovr-server"
        
        return 0
    else
        log_error "Some tests failed. Please check the issues above."
        
        echo ""
        echo "Common fixes:"
        echo "- For upload URL issues: Run ./fix-signblob-permission.sh"
        echo "- For bucket issues: Create bucket with 'gsutil mb gs://duovr-files-bucket'"
        echo "- For permissions: Check service account IAM roles"
        echo "- Server may still be starting up (wait 1-2 minutes)"
        
        return 1
    fi
}

# Check if curl is available
if ! command -v curl &> /dev/null; then
    log_error "curl is required but not found. Please install curl."
    exit 1
fi

# Run main function
main "$@"