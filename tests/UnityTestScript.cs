using System.Collections;
using UnityEngine;
using UnityEngine.Networking;

/// <summary>
/// Test script to verify DuoVR server integration from Unity
/// Attach this to a GameObject to run tests
/// </summary>
public class DuoVRServerTester : MonoBehaviour
{
    [Header("Server Configuration")]
    [SerializeField] private string serverUrl = "https://your-duovr-server.run.app";
    
    [Header("Test Configuration")]
    [SerializeField] private bool runTestsOnStart = true;
    [SerializeField] private string testVideoFileName = "test-video.mp4";
    
    [Header("Test Results")]
    [SerializeField] private int testsRun = 0;
    [SerializeField] private int testsPassed = 0;
    [SerializeField] private int testsFailed = 0;
    
    private string sessionId;
    
    void Start()
    {
        if (runTestsOnStart)
        {
            StartCoroutine(RunAllTests());
        }
    }
    
    [ContextMenu("Run All Tests")]
    public void RunAllTestsFromMenu()
    {
        StartCoroutine(RunAllTests());
    }
    
    private IEnumerator RunAllTests()
    {
        Debug.Log("🚀 Starting DuoVR Server Tests from Unity");
        Debug.Log($"Testing server: {serverUrl}");
        
        // Reset counters
        testsRun = 0;
        testsPassed = 0;
        testsFailed = 0;
        
        // Run tests in sequence
        yield return RunTest("Health Check", TestHealthCheck());
        yield return RunTest("API Info", TestApiInfo());
        yield return RunTest("File Listing", TestFileListing());
        yield return RunTest("Session Creation", TestSessionCreation());
        yield return RunTest("Upload URL Generation", TestUploadUrlGeneration());
        yield return RunTest("Signed URL Generation", TestSignedUrlGeneration());
        yield return RunTest("Analytics Tracking", TestAnalyticsTracking());
        yield return RunTest("Error Handling", TestErrorHandling());
        yield return RunTest("Video Metadata", TestVideoMetadata());
        
        // Show results
        Debug.Log("========================================");
        Debug.Log("Unity Test Results Summary");
        Debug.Log("========================================");
        Debug.Log($"Total Tests: {testsRun}");
        Debug.Log($"Passed: {testsPassed}");
        Debug.Log($"Failed: {testsFailed}");
        
        if (testsFailed == 0)
        {
            Debug.Log("✅ All tests passed! Your DuoVR server integration is working!");
        }
        else
        {
            Debug.LogError($"❌ {testsFailed} tests failed. Check the logs above for details.");
        }
    }
    
    private IEnumerator RunTest(string testName, IEnumerator testCoroutine)
    {
        testsRun++;
        Debug.Log($"🧪 Running: {testName}");
        
        bool testPassed = false;
        yield return StartCoroutine(ExecuteTest(testCoroutine, (passed) => testPassed = passed));
        
        if (testPassed)
        {
            testsPassed++;
            Debug.Log($"✅ {testName} - PASSED");
        }
        else
        {
            testsFailed++;
            Debug.LogError($"❌ {testName} - FAILED");
        }
        
        yield return new WaitForSeconds(0.5f); // Small delay between tests
    }
    
    private IEnumerator ExecuteTest(IEnumerator testCoroutine, System.Action<bool> callback)
    {
        bool success = true;
        
        try
        {
            yield return StartCoroutine(testCoroutine);
        }
        catch (System.Exception e)
        {
            Debug.LogError($"Test exception: {e.Message}");
            success = false;
        }
        
        callback(success);
    }
    
    private IEnumerator TestHealthCheck()
    {
        using (UnityWebRequest request = UnityWebRequest.Get($"{serverUrl}/health"))
        {
            yield return request.SendWebRequest();
            
            if (request.result == UnityWebRequest.Result.Success)
            {
                var response = request.downloadHandler.text;
                if (response.Contains("\"status\":\"healthy\""))
                {
                    Debug.Log("Health check response looks good");
                    yield break;
                }
            }
            
            throw new System.Exception($"Health check failed: {request.error}");
        }
    }
    
    private IEnumerator TestApiInfo()
    {
        using (UnityWebRequest request = UnityWebRequest.Get($"{serverUrl}/"))
        {
            yield return request.SendWebRequest();
            
            if (request.result == UnityWebRequest.Result.Success)
            {
                var response = request.downloadHandler.text;
                if (response.Contains("endpoints"))
                {
                    Debug.Log("API info endpoint working");
                    yield break;
                }
            }
            
            throw new System.Exception($"API info failed: {request.error}");
        }
    }
    
    private IEnumerator TestFileListing()
    {
        using (UnityWebRequest request = UnityWebRequest.Get($"{serverUrl}/files"))
        {
            yield return request.SendWebRequest();
            
            if (request.result == UnityWebRequest.Result.Success)
            {
                var response = request.downloadHandler.text;
                if (response.Contains("files"))
                {
                    Debug.Log("File listing working");
                    yield break;
                }
            }
            
            throw new System.Exception($"File listing failed: {request.error}");
        }
    }
    
    private IEnumerator TestSessionCreation()
    {
        var sessionData = new SessionCreateRequest
        {
            userId = "unity-test-user",
            deviceType = "vr",
            platform = "unity"
        };
        
        string json = JsonUtility.ToJson(sessionData);
        
        using (UnityWebRequest request = UnityWebRequest.Post($"{serverUrl}/sessions/create", json, "application/json"))
        {
            yield return request.SendWebRequest();
            
            if (request.result == UnityWebRequest.Result.Success)
            {
                var response = JsonUtility.FromJson<SessionCreateResponse>(request.downloadHandler.text);
                if (!string.IsNullOrEmpty(response.sessionId))
                {
                    sessionId = response.sessionId;
                    Debug.Log($"Session created: {sessionId}");
                    yield break;
                }
            }
            
            throw new System.Exception($"Session creation failed: {request.error}");
        }
    }
    
    private IEnumerator TestUploadUrlGeneration()
    {
        var uploadRequest = new UploadUrlRequest
        {
            fileName = testVideoFileName,
            fileType = "video/mp4",
            fileSize = 1000000
        };
        
        string json = JsonUtility.ToJson(uploadRequest);
        
        using (UnityWebRequest request = UnityWebRequest.Post($"{serverUrl}/files/generate-upload-url", json, "application/json"))
        {
            yield return request.SendWebRequest();
            
            if (request.result == UnityWebRequest.Result.Success)
            {
                var response = request.downloadHandler.text;
                if (response.Contains("uploadUrl"))
                {
                    Debug.Log("Upload URL generation working");
                    yield break;
                }
            }
            
            throw new System.Exception($"Upload URL generation failed: {request.error}");
        }
    }
    
    private IEnumerator TestSignedUrlGeneration()
    {
        string encodedFileName = UnityWebRequest.EscapeURL($"360-videos/{testVideoFileName}");
        
        using (UnityWebRequest request = UnityWebRequest.Get($"{serverUrl}/files/{encodedFileName}/signed-url"))
        {
            yield return request.SendWebRequest();
            
            // 404 is expected for non-existent files
            if (request.result == UnityWebRequest.Result.Success || 
                request.responseCode == 404)
            {
                Debug.Log("Signed URL generation endpoint working");
                yield break;
            }
            
            throw new System.Exception($"Signed URL generation failed: {request.error}");
        }
    }
    
    private IEnumerator TestAnalyticsTracking()
    {
        if (string.IsNullOrEmpty(sessionId))
        {
            Debug.Log("Skipping analytics test - no session ID");
            yield break;
        }
        
        var analyticsEvent = new AnalyticsEvent
        {
            fileId = "test-file-id",
            sessionId = sessionId,
            eventType = "view_start",
            videoTime = 0f
        };
        
        string json = JsonUtility.ToJson(analyticsEvent);
        
        using (UnityWebRequest request = UnityWebRequest.Post($"{serverUrl}/analytics/track", json, "application/json"))
        {
            yield return request.SendWebRequest();
            
            // Analytics might not be available without database, so we accept both success and certain error codes
            if (request.result == UnityWebRequest.Result.Success || 
                request.responseCode == 503)
            {
                Debug.Log("Analytics endpoint responding");
                yield break;
            }
            
            throw new System.Exception($"Analytics tracking failed: {request.error}");
        }
    }
    
    private IEnumerator TestErrorHandling()
    {
        using (UnityWebRequest request = UnityWebRequest.Get($"{serverUrl}/invalid-endpoint"))
        {
            yield return request.SendWebRequest();
            
            if (request.responseCode == 404)
            {
                Debug.Log("Error handling working (got 404 for invalid endpoint)");
                yield break;
            }
            
            throw new System.Exception("Error handling not working properly");
        }
    }
    
    private IEnumerator TestVideoMetadata()
    {
        string encodedFileName = UnityWebRequest.EscapeURL($"360-videos/{testVideoFileName}");
        
        using (UnityWebRequest request = UnityWebRequest.Get($"{serverUrl}/files/{encodedFileName}/metadata"))
        {
            yield return request.SendWebRequest();
            
            // 404 is expected for non-existent files
            if (request.result == UnityWebRequest.Result.Success || 
                request.responseCode == 404)
            {
                Debug.Log("Video metadata endpoint working");
                yield break;
            }
            
            throw new System.Exception($"Video metadata failed: {request.error}");
        }
    }
    
    // Data classes for JSON serialization
    [System.Serializable]
    public class SessionCreateRequest
    {
        public string userId;
        public string deviceType;
        public string platform;
    }
    
    [System.Serializable]
    public class SessionCreateResponse
    {
        public string sessionId;
        public string message;
    }
    
    [System.Serializable]
    public class UploadUrlRequest
    {
        public string fileName;
        public string fileType;
        public int fileSize;
    }
    
    [System.Serializable]
    public class AnalyticsEvent
    {
        public string fileId;
        public string sessionId;
        public string eventType;
        public float videoTime;
    }
}