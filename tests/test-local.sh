#!/bin/bash

# Local Development Testing Script
set -e

echo "🏠 Testing DuoVR Server Locally"
echo "================================"

# Check if .env exists
if [ ! -f ".env" ]; then
    echo "❌ .env file not found. Please create it from .env.example"
    exit 1
fi

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not installed"
    exit 1
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Start server in background
echo "🚀 Starting server locally..."
npm run dev &
SERVER_PID=$!

# Wait for server to start
echo "⏳ Waiting for server to start..."
sleep 5

# Test if server is responding
if curl -s http://localhost:3000/health > /dev/null; then
    echo "✅ Server started successfully!"
    
    # Run basic tests
    echo ""
    echo "🧪 Running basic tests..."
    
    # Test health endpoint
    echo "Testing health endpoint..."
    curl -s http://localhost:3000/health | head -c 200
    echo ""
    
    # Test file listing
    echo "Testing file listing..."
    curl -s http://localhost:3000/files | head -c 200
    echo ""
    
    # Test API info
    echo "Testing API info..."
    curl -s http://localhost:3000/ | head -c 200
    echo ""
    
    echo "✅ Local tests completed!"
    
else
    echo "❌ Server failed to start or not responding"
fi

# Clean up
echo "🧹 Cleaning up..."
kill $SERVER_PID 2>/dev/null || true
wait $SERVER_PID 2>/dev/null || true

echo "Local testing complete!"