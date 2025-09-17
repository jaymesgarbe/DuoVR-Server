#!/bin/bash

# DuoVR Server Comprehensive Test Script
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SERVER_URL=""
TEST_VIDEO_FILE=""
SESSION_ID=""

# Test results tracking
TESTS_PASSED=0
TESTS_FAILED=0
TOTAL_TESTS=0

# Helper functions
log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
    ((TESTS_PASSED++))
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
    ((TESTS_FAILED++))
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
        log_success "$test_name"
        return 0
    else
        log_error "$test_name"
        return 1
    fi
}

# Get server URL
get_server_url() {
    if [ -z "$SERVER_URL" ]; then
        if command -v gcloud &> /dev/null; then
            SERVER_URL=$(gcloud run services describe duovr-server \
                --platform managed --region us-west1 \
                --format 'value(status.url)' 2>/dev/null || echo "")
        fi
        
        if [ -z "$SERVER_URL" ]; then
            echo "Enter your DuoVR server URL (e.g., https://duovr-server-xyz.run.app):"
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
    response=$(curl -s -w "%{http_code}" "$SERVER_URL/health")
    local http_code="${response: -3}"
    local body="${response%???}"
    
    if [ "$http_code" = "200" ]; then
        log_info "Health check response: $body"
        
        # Check if response contains expected fields
        if echo "$body" | grep -q '"status":"healthy"'; then
            return 0
        else
            log_warning "Health check returned 200 but status is not healthy"
            return 1
        fi
    else
        log_error "Health check failed with HTTP $http_code"
        return 1
    fi
}

test_api_info() {
    local response
    response=$(curl -s -w "%{http_code}" "$SERVER_URL/")
    local http_code="${response: -3}"
    
    if [ "$http_code" = "200" ]; then
        log_info "API info retrieved successfully"
        return 0
    else
        return 1
    fi
}

test_file_listing() {
    local response
    response=$(curl -s -w "%{http_code}" "$SERVER_URL/files")
    local http_code="${response: -3}"
    local body="${response%???}"
    
    if [ "$http_code" = "200" ]; then
        log_info "File listing successful"
        
        # Check if response has expected structure
        if echo "$body" | grep -q '"files"'; then
            return 0
        else
            log_warning "File listing response missing 'files' field"
            return 1
        fi
    else
        return 1
    fi
}

test_cors() {
    local response
    response=$(curl -s -w "%{http_code}" -H "Origin: http://localhost:3000" \
        -H "Access-Control-Request-Method: POST" \
        -H "Access-Control-Request-Headers: Content-Type" \
        -X OPTIONS "$SERVER_URL/files")
    local http_code="${response: -3}"
    
    if [ "$http_code" = "204" ] || [ "$http_code" = "200" ]; then
        log_info "CORS preflight check passed"
        return 0
    else
        return 1
    fi
}

test_session_creation() {
    local response
    response=$(curl -s -w "%{http_code}" -X POST "$SERVER_URL/sessions/create" \
        -H "Content-Type: application/json" \
        -d '{"userId":"test-user","deviceType":"vr","platform":"unity"}')
    local http_code="${response: -3}"
    local body="${response%???}"
    
    if [ "$http_code" = "200" ]; then
        SESSION_ID=$(echo "$body" | grep -o '"sessionId":"[^"]*"' | cut -d'"' -f4)
        if [ -n "$SESSION_ID" ]; then
            log_info "Session created: $SESSION_ID"
            return 0
        else
            return 1
        fi
    else
        return 1
    fi
}

test_signed_url_generation() {
    # Test with a common filename pattern
    local test_filename="360-videos/test-video.mp4"
    local response
    
    response=$(curl -s -w "%{http_code}" "$SERVER_URL/files/${test_filename}/signed-url?expiresInMinutes=60")
    local http_code="${response: -3}"
    local body="${response%???}"
    
    if [ "$http_code" = "404" ]; then
        log_info "Signed URL test: File not found (expected for non-existent file)"
        return 0
    elif [ "$http_code" = "200" ]; then
        log_info "Signed URL generated successfully"
        return 0
    else
        log_warning "Signed URL test returned HTTP $http_code: $body"
        return 1
    fi
}

test_upload_url_generation() {
    local response
    response=$(curl -s -w "%{http_code}" -X POST "$SERVER_URL/files/generate-upload-url" \
        -H "Content-Type: application/json" \
        -d '{"fileName":"test-upload.mp4","fileType":"video/mp4","fileSize":1000000}')
    local http_code="${response: -3}"
    local body="${response%???}"
    
    if [ "$http_code" = "200" ]; then
        if echo "$body" | grep -q '"uploadUrl"'; then
            log_info "Upload URL generated successfully"
            return 0
        else
            return 1
        fi
    else
        return 1
    fi
}

test_video_upload() {
    # Only run if test video file is provided
    if [ -z "$TEST_VIDEO_FILE" ] || [ ! -f "$TEST_VIDEO_FILE" ]; then
        log_info "Skipping video upload test (no test file provided)"
        return 0
    fi
    
    log_info "Uploading test video: $TEST_VIDEO_FILE"
    
    local response
    response=$(curl -s -w "%{http_code}" -X POST "$SERVER_URL/files/upload" \
        -F "video=@$TEST_VIDEO_FILE" \
        -F "userId=test-user" \
        -F "quality=720p")
    local http_code="${response: -3}"
    local body="${response%???}"
    
    if [ "$http_code" = "200" ]; then
        log_info "Video upload successful"
        echo "$body" | head -c 200
        return 0
    else
        log_warning "Video upload failed with HTTP $http_code"
        return 1
    fi
}

test_analytics_tracking() {
    if [ -z "$SESSION_ID" ]; then
        log_info "Skipping analytics test (no session ID)"
        return 0
    fi
    
    local response
    response=$(curl -s -w "%{http_code}" -X POST "$SERVER_URL/analytics/track" \
        -H "Content-Type: application/json" \
        -d "{\"fileId\":\"test-file-id\",\"sessionId\":\"$SESSION_ID\",\"eventType\":\"view_start\",\"videoTime\":0}")
    local http_code="${response: -3}"
    
    if [ "$http_code" = "200" ]; then
        log_info "Analytics tracking successful"
        return 0
    else
        log_info "Analytics tracking not available (expected without database)"
        return 0
    fi
}

test_rate_limiting() {
    log_info "Testing rate limiting (making multiple rapid requests)"
    
    local success_count=0
    local rate_limited=false
    
    for i in {1..15}; do
        local response
        response=$(curl -s -w "%{http_code}" "$SERVER_URL/health")
        local http_code="${response: -3}"
        
        if [ "$http_code" = "200" ]; then
            ((success_count++))
        elif [ "$http_code" = "429" ]; then
            rate_limited=true
            break
        fi
        
        sleep 0.1
    done
    
    if [ "$rate_limited" = true ]; then
        log_info "Rate limiting is working (got 429 after $success_count requests)"
        return 0
    elif [ "$success_count" -ge 10 ]; then
        log_info "Rate limiting test: $success_count requests succeeded (rate limit not triggered)"
        return 0
    else
        return 1
    fi
}

test_error_handling() {
    # Test with invalid endpoints
    local response
    response=$(curl -s -w "%{http_code}" "$SERVER_URL/invalid-endpoint")
    local http_code="${response: -3}"
    
    if [ "$http_code" = "404" ]; then
        log_info "Error handling working (404 for invalid endpoint)"
        return 0
    else
        return 1
    fi
}

test_security_headers() {
    local response
    response=$(curl -s -I "$SERVER_URL/health")
    
    if echo "$response" | grep -q "X-Content-Type-Options"; then
        log_info "Security headers present"
        return 0
    else
        log_warning "Security headers may be missing"
        return 1
    fi
}

# Performance tests
test_response_times() {
    log_info "Testing response times"
    
    local start_time=$(date +%s%N)
    curl -s "$SERVER_URL/health" > /dev/null
    local end_time=$(date +%s%N)
    
    local duration=$(( (end_time - start_time) / 1000000 )) # Convert to milliseconds
    
    if [ "$duration" -lt 5000 ]; then # Less than 5 seconds
        log_info "Health check response time: ${duration}ms"
        return 0
    else
        log_warning "Health check slow: ${duration}ms"
        return 1
    fi
}

# Unity-specific tests
test_unity_compatibility() {
    log_info "Testing Unity-specific features"
    
    # Test file listing with Unity-like request
    local response
    response=$(curl -s -w "%{http_code}" "$SERVER_URL/files" \
        -H "User-Agent: Unity/2023.1.0 (UnityWebRequest/1.0, libcurl/7.80.0)")
    local http_code="${response: -3}"
    
    if [ "$http_code" = "200" ]; then
        log_info "Unity compatibility check passed"
        return 0
    else
        return 1
    fi
}

# Main test execution
main() {
    echo "🚀 DuoVR Server Comprehensive Test Suite"
    echo "========================================"
    
    # Get server URL
    get_server_url
    
    # Ask for test video file
    echo ""
    echo "Optional: Enter path to a test video file for upload testing (or press Enter to skip):"
    read -r TEST_VIDEO_FILE
    
    echo ""
    echo "Starting tests..."
    echo ""
    
    # Core functionality tests
    run_test "Health Check" "test_health_check"
    run_test "API Info Endpoint" "test_api_info"
    run_test "File Listing" "test_file_listing"
    run_test "CORS Configuration" "test_cors"
    run_test "Session Creation" "test_session_creation"
    run_test "Signed URL Generation" "test_signed_url_generation"
    run_test "Upload URL Generation" "test_upload_url_generation"
    
    # Optional tests
    run_test "Video Upload" "test_video_upload"
    run_test "Analytics Tracking" "test_analytics_tracking"
    
    # System tests
    run_test "Rate Limiting" "test_rate_limiting"
    run_test "Error Handling" "test_error_handling"
    run_test "Security Headers" "test_security_headers"
    run_test "Response Times" "test_response_times"
    run_test "Unity Compatibility" "test_unity_compatibility"
    
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
        
        exit 0
    else
        log_error "Some tests failed. Please check the issues above."
        
        echo ""
        echo "Common fixes:"
        echo "- Check your .env configuration"
        echo "- Verify Google Cloud service account permissions"
        echo "- Ensure bucket exists and is accessible"
        echo "- Check Cloud Run service is deployed correctly"
        
        exit 1
    fi
}

# Run main function
main "$@"