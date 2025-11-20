# Interview Mod - Event Documentation

## Overview

The Interview Mod provides a private AI interview system with resume management, job postings, interview scheduling, and notification features. All interview topics are private and only accessible to the topic owner, interviewers, and administrators.

## Table of Contents

- [User Operations](#user-operations)
- [File Operations](#file-operations)
- [Topic Operations](#topic-operations)
- [Comment Operations](#comment-operations)
- [Job Operations](#job-operations)
- [Interview Operations](#interview-operations)
- [Notification Operations](#notification-operations)
- [Broadcast Events](#broadcast-events)
- [Admin Operations](#admin-operations)
- [Interview Decision Management](#interview-decision-management)
- [Access Control](#access-control)

---

## User Operations

### 1. Register User Information

**Event:** `interview.user.register`

**Description:** Register or update user (job candidate) basic information. This information is stored persistently in the workspace users/ directory.

**Input:**
```json
{
  "email": "john.doe@example.com",
  "first_name": "John",
  "last_name": "Doe"
}
```

**Response (Success - New User):**
```json
{
  "success": true,
  "message": "User information registered successfully",
  "data": {
    "user": {
      "user_id": "agent-12345",
      "email": "john.doe@example.com",
      "first_name": "John",
      "last_name": "Doe",
      "registered_at": 1699891234,
      "updated_at": 1699891234
    },
    "is_new": true
  }
}
```

**Response (Success - Update Existing):**
```json
{
  "success": true,
  "message": "User information updated successfully",
  "data": {
    "user": {
      "user_id": "agent-12345",
      "email": "john.doe@example.com",
      "first_name": "John",
      "last_name": "Doe",
      "registered_at": 1699891234,
      "updated_at": 1699895678
    },
    "is_new": false
  }
}
```

**Response (Error):**
```json
{
  "success": false,
  "message": "Missing required fields: email, first_name, and last_name are required"
}
```

**Validation Rules:**
- All three fields (email, first_name, last_name) are required
- Email must contain @ and a domain with a dot
- Fields are trimmed of whitespace
- user_id is automatically set to the event source_id

---

### 2. Get User Information

**Event:** `interview.user.get`

**Description:** Retrieve user (job candidate) information. If no user_id is provided, retrieves information for the current user (event source).

**Input (Optional):**
```json
{
  "user_id": "agent-12345"
}
```

If payload is omitted or user_id is not provided, uses the event source_id.

**Response (Success):**
```json
{
  "success": true,
  "message": "User information retrieved successfully",
  "data": {
    "user": {
      "user_id": "agent-12345",
      "email": "john.doe@example.com",
      "first_name": "John",
      "last_name": "Doe",
      "registered_at": 1699891234,
      "updated_at": 1699891234
    },
    "registered": true
  }
}
```

**Response (User Not Found):**
```json
{
  "success": false,
  "message": "User information not found. Please register first.",
  "data": {
    "registered": false
  }
}
```

---

### 3. Get General Assessment Link

**Event:** `interview.get_general_assessment_link`

**Description:** Get or create a general assessment link for the user. The link is cached in the user's data so subsequent calls return the same link without creating a new application.

**Input (Optional):**
```json
{
  "job_id": "job_simulationtest_eng-conv-5",
  "peakmojo_api_url": "http://localhost:9500",
  "skip_email": false
}
```

All fields are optional:
- `job_id`: Defaults to "job_simulationtest_eng-conv-5"
- `peakmojo_api_url`: Defaults to "http://localhost:9500"
- `skip_email`: Defaults to false

**Response (Success - New Link):**
```json
{
  "success": true,
  "message": "General assessment link created successfully",
  "data": {
    "assessment_link": "https://beta.readymojo.com/interview-flow/job_simulationtest_eng-conv-5/1b95ae92-6062-4dbd-b62d-f789af2720a2/action/prep/faef1f15-39f4-497c-bbc4-1ba282b3b7df/",
    "application_id": "1b95ae92-6062-4dbd-b62d-f789af2720a2",
    "practice_session_id": "faef1f15-39f4-497c-bbc4-1ba282b3b7df",
    "cached": false
  }
}
```

**Response (Success - Cached Link):**
```json
{
  "success": true,
  "message": "General assessment link retrieved from cache",
  "data": {
    "assessment_link": "https://beta.readymojo.com/interview-flow/job_simulationtest_eng-conv-5/1b95ae92-6062-4dbd-b62d-f789af2720a2/action/prep/faef1f15-39f4-497c-bbc4-1ba282b3b7df/",
    "application_id": "1b95ae92-6062-4dbd-b62d-f789af2720a2",
    "practice_session_id": "faef1f15-39f4-497c-bbc4-1ba282b3b7df",
    "cached": true
  }
}
```

**Response (Error - User Not Registered):**
```json
{
  "success": false,
  "message": "User not registered. Please register first."
}
```

**Response (Error - API Failure):**
```json
{
  "success": false,
  "message": "Failed to create application: 400"
}
```

**How It Works:**
1. Checks if user is registered
2. If link exists in cache, returns it immediately
3. Otherwise, creates a new application via PeakMojo API `/v1/applications`
4. Generates a random practice session ID using UUID4
5. Constructs the assessment link: `https://beta.readymojo.com/interview-flow/{job_id}/{application_id}/action/prep/{practice_session_id}/`
6. Caches the link, application ID, and practice session ID in user data file
7. Returns the link

**Caching Behavior:**
- Link is stored in `workspace/users/{user_id}.json`
- Subsequent calls return the cached link without creating a new application
- Cache persists across sessions

---

## File Operations

### 1. Upload Resume File

**Event:** `interview.file.upload`

**Description:** Upload a PDF resume file to the network storage.

**Input:**
```json
{
  "filename": "john_doe_resume.pdf",
  "file_content": "JVBERi0xLjQKJeLjz9MKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwovUGFnZXMgMiAwIFIKPj4KZW5kb2JqCjIgMCBvYmoKPDwKL1R5cGUgL1BhZ2VzCi9LaWRzIFszIDAgUl0KL0NvdW50IDEK...",
  "mime_type": "application/pdf",
  "file_size": 125432
}
```

**Response (Success):**
```json
{
  "success": true,
  "message": "File uploaded successfully",
  "data": {
    "file_id": "550e8400-e29b-41d4-a716-446655440000",
    "filename": "john_doe_resume.pdf",
    "size": 125432,
    "resume_url": "file://550e8400-e29b-41d4-a716-446655440000"
  }
}
```

**Response (Error):**
```json
{
  "success": false,
  "message": "File size (15728640 bytes) exceeds maximum allowed size (10485760 bytes)"
}
```

**Validation Rules:**
- File must be PDF format (checked via magic number)
- Maximum file size: 10MB
- MIME type must be `application/pdf`
- Filename must end with `.pdf`

---

### 2. Download Resume File

**Event:** `interview.file.download`

**Description:** Download a previously uploaded file by its file ID.

**Input:**
```json
{
  "file_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Response (Success):**
```json
{
  "success": true,
  "message": "File retrieved successfully",
  "data": {
    "file_id": "550e8400-e29b-41d4-a716-446655440000",
    "filename": "john_doe_resume.pdf",
    "mime_type": "application/pdf",
    "size": 125432,
    "file_content": "JVBERi0xLjQKJeLjz9MKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwovUGFnZXMgMiAwIFIKPj4KZW5kb2JqCjIgMCBvYmoKPDwKL1R5cGUgL1BhZ2VzCi9LaWRzIFszIDAgUl0KL0NvdW50IDEK...",
    "uploaded_by": "agent-001",
    "upload_timestamp": 1699891234.567
  }
}
```

**Response (Error):**
```json
{
  "success": false,
  "message": "File not found"
}
```

---

### 3. Get File Metadata

**Event:** `interview.file.get`

**Description:** Retrieve file metadata without downloading the full content.

**Input:**
```json
{
  "file_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Response (Success):**
```json
{
  "success": true,
  "message": "File info retrieved successfully",
  "data": {
    "file": {
      "file_id": "550e8400-e29b-41d4-a716-446655440000",
      "filename": "john_doe_resume.pdf",
      "mime_type": "application/pdf",
      "size": 125432,
      "uploaded_by": "agent-001",
      "upload_timestamp": 1699891234.567
    }
  }
}
```

---

## Topic Operations

### 4. Create Interview Topic

**Event:** `interview.topic.create`

**Description:** Create a new interview topic with a required PDF resume attachment.

**Input:**
```json
{
  "title": "Software Engineer Position - John Doe",
  "content": "Application for Senior Software Engineer position. 5+ years of experience in React, Node.js, and AWS.",
  "resume_url": "file://550e8400-e29b-41d4-a716-446655440000",
  "resume_blob": "JVBERi0xLjQK..." // Optional: base64 preview blob
}
```

**Response (Success):**
```json
{
  "success": true,
  "message": "Interview topic created successfully",
  "data": {
    "topic_id": "660e8400-e29b-41d4-a716-446655440111",
    "topic": {
      "topic_id": "660e8400-e29b-41d4-a716-446655440111",
      "title": "Software Engineer Position - John Doe",
      "content": "Application for Senior Software Engineer position. 5+ years of experience in React, Node.js, and AWS.",
      "resume_url": "file://550e8400-e29b-41d4-a716-446655440000",
      "resume_blob": "JVBERi0xLjQK...",
      "owner_id": "agent-001",
      "visibility": "private",
      "timestamp": 1699891234.567,
      "comment_count": 0,
      "last_activity": 1699891234.567
    }
  }
}
```

**Response (Error):**
```json
{
  "success": false,
  "message": "PDF resume is required for interview topics"
}
```

**Triggers Broadcast:** `interview.topic.created` (without blob to save bandwidth)

---

### 5. Delete Interview Topic

**Event:** `interview.topic.delete`

**Description:** Delete an interview topic. Only the topic owner can delete.

**Input:**
```json
{
  "topic_id": "660e8400-e29b-41d4-a716-446655440111"
}
```

**Response (Success):**
```json
{
  "success": true,
  "message": "Topic deleted successfully",
  "data": {
    "topic_id": "660e8400-e29b-41d4-a716-446655440111"
  }
}
```

**Response (Error):**
```json
{
  "success": false,
  "message": "Only topic owner can delete"
}
```

**Triggers Broadcast:** `interview.topic.deleted`

---

### 6. List Interview Topics

**Event:** `interview.topic.list`

**Description:** List all interview topics accessible to the requesting agent. Results are filtered by access permissions and sorted by last activity.

**Input:**
```json
{
  "limit": 50,
  "offset": 0
}
```

**Response (Success):**
```json
{
  "success": true,
  "message": "Topics retrieved successfully",
  "data": {
    "topics": [
      {
        "topic_id": "660e8400-e29b-41d4-a716-446655440111",
        "title": "Software Engineer Position - John Doe",
        "content": "Application for Senior Software Engineer position...",
        "resume_url": "file://550e8400-e29b-41d4-a716-446655440000",
        "owner_id": "agent-001",
        "visibility": "private",
        "timestamp": 1699891234.567,
        "comment_count": 5,
        "last_activity": 1699895634.789
      }
    ],
    "total_count": 15,
    "offset": 0,
    "limit": 50,
    "has_more": false
  }
}
```

---

### 7. Search Interview Topics

**Event:** `interview.topic.search`

**Description:** Search interview topics by keyword in title or content. Results are filtered by access permissions.

**Input:**
```json
{
  "query": "software engineer",
  "limit": 50,
  "offset": 0
}
```

**Response (Success):**
```json
{
  "success": true,
  "message": "Search completed successfully",
  "data": {
    "topics": [
      {
        "topic_id": "660e8400-e29b-41d4-a716-446655440111",
        "title": "Software Engineer Position - John Doe",
        "content": "Application for Senior Software Engineer position...",
        "resume_url": "file://550e8400-e29b-41d4-a716-446655440000",
        "owner_id": "agent-001",
        "visibility": "private",
        "timestamp": 1699891234.567,
        "comment_count": 5,
        "last_activity": 1699895634.789
      }
    ],
    "query": "software engineer",
    "total_count": 3,
    "offset": 0,
    "limit": 50,
    "has_more": false
  }
}
```

---

### 8. Get Single Topic with Comments

**Event:** `interview.topic.get`

**Description:** Retrieve a single topic with its full comment tree.

**Input:**
```json
{
  "topic_id": "660e8400-e29b-41d4-a716-446655440111"
}
```

**Response (Success):**
```json
{
  "success": true,
  "message": "Topic retrieved successfully",
  "data": {
    "topic": {
      "topic_id": "660e8400-e29b-41d4-a716-446655440111",
      "title": "Software Engineer Position - John Doe",
      "content": "Application for Senior Software Engineer position...",
      "resume_url": "file://550e8400-e29b-41d4-a716-446655440000",
      "resume_blob": "JVBERi0xLjQK...",
      "owner_id": "agent-001",
      "visibility": "private",
      "timestamp": 1699891234.567,
      "comment_count": 2,
      "last_activity": 1699895634.789,
      "comments": [
        {
          "comment_id": "770e8400-e29b-41d4-a716-446655440222",
          "topic_id": "660e8400-e29b-41d4-a716-446655440111",
          "content": "Great experience! Let's schedule an interview.",
          "author_id": "interviewer-001",
          "timestamp": 1699892345.678,
          "parent_comment_id": null,
          "thread_level": 0,
          "depth": 0,
          "deleted": false,
          "replies": [
            {
              "comment_id": "880e8400-e29b-41d4-a716-446655440333",
              "topic_id": "660e8400-e29b-41d4-a716-446655440111",
              "content": "Thank you! I'm available next week.",
              "author_id": "agent-001",
              "timestamp": 1699895634.789,
              "parent_comment_id": "770e8400-e29b-41d4-a716-446655440222",
              "thread_level": 1,
              "depth": 1,
              "deleted": false,
              "replies": []
            }
          ]
        }
      ]
    }
  }
}
```

**Response (Error):**
```json
{
  "success": false,
  "message": "Unauthorized to access this topic"
}
```

---

### 9. List Topics by User

**Event:** `interview.topic.list_by_user`

**Description:** List interview topics created by a specific user.

**Input:**
```json
{
  "user_id": "agent-001",
  "limit": 50,
  "offset": 0
}
```

**Response (Success):**
```json
{
  "success": true,
  "message": "User topics retrieved successfully",
  "data": {
    "topics": [
      {
        "topic_id": "660e8400-e29b-41d4-a716-446655440111",
        "title": "Software Engineer Position - John Doe",
        "content": "Application for Senior Software Engineer position...",
        "resume_url": "file://550e8400-e29b-41d4-a716-446655440000",
        "owner_id": "agent-001",
        "visibility": "private",
        "timestamp": 1699891234.567,
        "comment_count": 5,
        "last_activity": 1699895634.789
      }
    ],
    "user_id": "agent-001",
    "total_count": 8,
    "offset": 0,
    "limit": 50,
    "has_more": false
  }
}
```

---

## Comment Operations

### 10. Create Comment

**Event:** `interview.comment.create`

**Description:** Create a root-level comment on a topic.

**Input:**
```json
{
  "topic_id": "660e8400-e29b-41d4-a716-446655440111",
  "content": "Your background looks impressive! Let's discuss the role further."
}
```

**Response (Success):**
```json
{
  "success": true,
  "message": "Comment created successfully",
  "data": {
    "comment_id": "770e8400-e29b-41d4-a716-446655440222",
    "comment": {
      "comment_id": "770e8400-e29b-41d4-a716-446655440222",
      "topic_id": "660e8400-e29b-41d4-a716-446655440111",
      "content": "Your background looks impressive! Let's discuss the role further.",
      "author_id": "interviewer-001",
      "timestamp": 1699892345.678,
      "parent_comment_id": null,
      "thread_level": 0,
      "depth": 0,
      "deleted": false
    }
  }
}
```

**Triggers Broadcast:** `interview.comment.created`

---

### 11. Reply to Comment

**Event:** `interview.comment.reply`

**Description:** Create a reply to an existing comment. Alias for `interview.comment.create` with `parent_comment_id`.

**Input:**
```json
{
  "topic_id": "660e8400-e29b-41d4-a716-446655440111",
  "content": "Thank you! I'm very interested in this opportunity.",
  "parent_comment_id": "770e8400-e29b-41d4-a716-446655440222"
}
```

**Response (Success):**
```json
{
  "success": true,
  "message": "Comment created successfully",
  "data": {
    "comment_id": "880e8400-e29b-41d4-a716-446655440333",
    "comment": {
      "comment_id": "880e8400-e29b-41d4-a716-446655440333",
      "topic_id": "660e8400-e29b-41d4-a716-446655440111",
      "content": "Thank you! I'm very interested in this opportunity.",
      "author_id": "agent-001",
      "timestamp": 1699895634.789,
      "parent_comment_id": "770e8400-e29b-41d4-a716-446655440222",
      "thread_level": 1,
      "depth": 1,
      "deleted": false
    }
  }
}
```

**Response (Error):**
```json
{
  "success": false,
  "message": "Maximum comment depth (5) reached"
}
```

**Triggers Broadcast:** `interview.comment.replied`

**Constraints:**
- Maximum nesting depth: 5 levels
- Parent comment must exist

---

### 12. Delete Comment

**Event:** `interview.comment.delete`

**Description:** Soft-delete a comment and all its child replies. Only the comment author or admin can delete.

**Input:**
```json
{
  "topic_id": "660e8400-e29b-41d4-a716-446655440111",
  "comment_id": "770e8400-e29b-41d4-a716-446655440222"
}
```

**Response (Success):**
```json
{
  "success": true,
  "message": "Comment and 3 replies deleted successfully",
  "data": {
    "comment_id": "770e8400-e29b-41d4-a716-446655440222",
    "deleted_count": 4
  }
}
```

**Response (Error):**
```json
{
  "success": false,
  "message": "Only comment author or admin can delete"
}
```

**Triggers Broadcast:** `interview.comment.deleted`

**Note:** Deleted comments are soft-deleted (marked as deleted but not removed from the database). They appear as `[deleted]` in the comment tree.

---

## Job Operations

### 13. List Jobs

**Event:** `interview.jobs.list`

**Description:** List all job postings with optional status filter.

**Input:**
```json
{
  "status": "open"  // Optional: "open", "closed", "filled"
}
```

**Response (Success):**
```json
{
  "success": true,
  "message": "Jobs retrieved successfully",
  "data": {
    "jobs": [
      {
        "job_id": "test_job_001",
        "title": "Senior Software Engineer",
        "company_name": "Tech Company",
        "image_url": "",
        "posted_date": 1699891234,
        "posted_agent_id": "broadcast",
        "status": "open",
        "brief_description": "We are looking for an experienced Senior Software Engineer to join our team. You will be responsible for designing and developing scalable software solutions...",
        "detailed_description": "We are looking for an experienced Senior Software Engineer to join our team. You will be responsible for designing and developing scalable software solutions, collaborating with cross-functional teams, and mentoring junior developers.",
        "location": "San Francisco, CA",
        "requirements": ["5+ years of experience", "Strong knowledge of React and TypeScript", "Experience with AWS"]
      }
    ],
    "total_count": 6
  }
}
```

---

### 14. Get Job Details

**Event:** `interview.jobs.get`

**Description:** Retrieve detailed information about a specific job posting.

**Input:**
```json
{
  "job_id": "test_job_001"
}
```

**Response (Success):**
```json
{
  "success": true,
  "message": "Job retrieved successfully",
  "data": {
    "job_id": "test_job_001",
    "title": "Senior Software Engineer",
    "company_name": "Tech Company",
    "image_url": "",
    "posted_date": 1699891234,
    "posted_agent_id": "broadcast",
    "status": "open",
    "detailed_description": "We are looking for an experienced Senior Software Engineer to join our team. You will be responsible for designing and developing scalable software solutions, collaborating with cross-functional teams, and mentoring junior developers.",
    "requirements": ["5+ years of experience", "Strong knowledge of React and TypeScript", "Experience with AWS"],
    "salary_range": "$120,000 - $180,000",
    "location": "San Francisco, CA",
    "contact_info": ""
  }
}
```

**Response (Error):**
```json
{
  "success": false,
  "message": "Job not found"
}
```

---

### 15. Update/Create Job

**Event:** `interview.jobs.put`

**Description:** Update an existing job posting or create a new one if it doesn't exist.

**Input (Create New):**
```json
{
  "job_id": "custom_job_001",
  "title": "Frontend Developer",
  "company_name": "Startup Inc",
  "detailed_description": "Looking for a talented Frontend Developer...",
  "image_url": "https://example.com/logo.png",
  "requirements": ["3+ years React", "TypeScript", "CSS"],
  "salary_range": "$90,000 - $130,000",
  "location": "Remote",
  "status": "open",
  "contact_info": "hr@startup.com"
}
```

**Input (Update Existing):**
```json
{
  "job_id": "test_job_001",
  "status": "filled",
  "salary_range": "$130,000 - $190,000"
}
```

**Response (Success):**
```json
{
  "success": true,
  "message": "Job updated successfully",
  "data": {
    "job_id": "test_job_001",
    "updated_fields": ["status", "salary_range"],
    "updated_at": 1699895634,
    "success": true
  }
}
```

**Updatable Fields:**
- title
- company_name
- image_url
- detailed_description
- requirements
- salary_range
- location
- status
- application_deadline
- contact_info

---

### 16. Delete Job

**Event:** `interview.jobs.delete`

**Description:** Delete a job posting.

**Input:**
```json
{
  "job_id": "test_job_001"
}
```

**Response (Success):**
```json
{
  "success": true,
  "message": "Job deleted successfully",
  "data": {
    "job_id": "test_job_001",
    "deleted_at": 1699895634,
    "success": true
  }
}
```

---

## Interview Operations

### 17. List Interviews

**Event:** `interview.interviews.list`

**Description:** List all interview sessions with optional status filter.

**Input:**
```json
{
  "status": "scheduled"  // Optional: "scheduled", "completed", "cancelled"
}
```

**Response (Success):**
```json
{
  "success": true,
  "message": "Interviews retrieved successfully",
  "data": {
    "interviews": [
      {
        "interview_id": "interview_001",
        "job_id": "test_job_001",
        "status": "scheduled",
        "interview_url": "https://meet.example.com/interview/001",
        "interview_type": "virtual",
        "duration_minutes": 60,
        "results": {},
        "created_at": 1699891234,
        "updated_at": 1699892345,
        "notes": "Please prepare for technical questions about React and TypeScript."
      },
      {
        "interview_id": "interview_003",
        "job_id": "test_job_003",
        "status": "completed",
        "interview_url": null,
        "interview_type": null,
        "duration_minutes": null,
        "results": {
          "score": 85,
          "feedback": "Strong technical skills demonstrated."
        },
        "created_at": 1699631234,
        "updated_at": 1699805034,
        "notes": "Interview completed successfully."
      }
    ],
    "total_count": 5
  }
}
```

**Note:** For `completed` and `cancelled` status interviews, `interview_url`, `interview_type`, and `duration_minutes` are set to `null`.

---

### 18. Schedule Interview

**Event:** `interview.interviews.add`

**Description:** Schedule a new interview session.

**Input:**
```json
{
  "job_id": "test_job_001",
  "interview_url": "https://zoom.us/j/1234567890",
  "interview_type": "virtual",
  "duration_minutes": 60,
  "notes": "Please review the technical assessment before the interview."
}
```

**Response (Success):**
```json
{
  "success": true,
  "message": "Interview scheduled successfully",
  "data": {
    "interview_id": "interview_007",
    "status": "scheduled",
    "created_at": 1699895634
  }
}
```

**Response (Error):**
```json
{
  "success": false,
  "message": "Missing required field: interview_url"
}
```

**Required Fields:**
- job_id
- interview_url
- interview_type

**Optional Fields:**
- duration_minutes (default: 60)
- notes

---

### 19. Cancel Interview

**Event:** `interview.interviews.delete`

**Description:** Cancel/delete an interview session.

**Input:**
```json
{
  "interview_id": "interview_001",
  "reason": "Candidate withdrew application"
}
```

**Response (Success):**
```json
{
  "success": true,
  "message": "Interview cancelled successfully",
  "data": {
    "interview_id": "interview_001",
    "cancelled_at": 1699895634,
    "reason": "Candidate withdrew application",
    "success": true
  }
}
```

**Note:** This operation marks the interview as `cancelled` rather than deleting it from the database.

---

## Notification Operations

### 20. List Notifications

**Event:** `interview.notification.list`

**Description:** List notifications for the requesting agent with pagination and filtering.

**Input:**
```json
{
  "limit": 50,
  "offset": 0,
  "status": "unread",  // Optional: "unread", "read"
  "type": "interview_scheduled"  // Optional: filter by notification type
}
```

**Response (Success):**
```json
{
  "success": true,
  "message": "Notifications retrieved successfully",
  "data": {
    "notifications": [
      {
        "notification_id": "990e8400-e29b-41d4-a716-446655440444",
        "recipient_id": "agent-001",
        "type": "interview_scheduled",
        "message": "Your interview for Senior Software Engineer position has been scheduled for December 15, 2024 at 10:00 AM.",
        "created_at": 1699895634,
        "status": "unread"
      },
      {
        "notification_id": "aa0e8400-e29b-41d4-a716-446655440555",
        "recipient_id": "agent-001",
        "type": "comment_reply",
        "message": "The interviewer has replied to your comment on 'Software Engineer Position - John Doe'.",
        "created_at": 1699892345,
        "status": "read"
      }
    ],
    "total_count": 12,
    "offset": 0,
    "limit": 50,
    "has_more": false
  }
}
```

---

### 21. Add Notification

**Event:** `interview.notification.add`

**Description:** Create a new notification for a specific agent.

**Input:**
```json
{
  "recipient_id": "agent-001",
  "type": "interview_reminder",
  "message": "Reminder: Your interview is scheduled in 24 hours."
}
```

**Response (Success):**
```json
{
  "success": true,
  "message": "Notification created successfully",
  "data": {
    "notification_id": "bb0e8400-e29b-41d4-a716-446655440666"
  }
}
```

**Response (Error):**
```json
{
  "success": false,
  "message": "Missing required field: message"
}
```

**Required Fields:**
- recipient_id
- type
- message

**Common Notification Types:**
- `interview_scheduled`
- `interview_cancelled`
- `interview_reminder`
- `comment_reply`
- `topic_created`
- `application_received`

---

## Broadcast Events

These events are automatically broadcast to all connected agents when certain operations occur. They are notification-only events and do not expect a response.

### interview.topic.created

**Payload:**
```json
{
  "topic": {
    "topic_id": "660e8400-e29b-41d4-a716-446655440111",
    "title": "Software Engineer Position - John Doe",
    "content": "Application for Senior Software Engineer position...",
    "resume_url": "file://550e8400-e29b-41d4-a716-446655440000",
    "owner_id": "agent-001",
    "visibility": "private",
    "timestamp": 1699891234.567,
    "comment_count": 0,
    "last_activity": 1699891234.567
  }
}
```

**Note:** The `resume_blob` is excluded from broadcast to save bandwidth.

---

### interview.topic.deleted

**Payload:**
```json
{
  "topic_id": "660e8400-e29b-41d4-a716-446655440111"
}
```

---

### interview.comment.created

**Payload:**
```json
{
  "comment": {
    "comment_id": "770e8400-e29b-41d4-a716-446655440222",
    "topic_id": "660e8400-e29b-41d4-a716-446655440111",
    "content": "Great experience! Let's schedule an interview.",
    "author_id": "interviewer-001",
    "timestamp": 1699892345.678,
    "parent_comment_id": null,
    "thread_level": 0,
    "depth": 0,
    "deleted": false
  },
  "topic_id": "660e8400-e29b-41d4-a716-446655440111"
}
```

---

### interview.comment.replied

**Payload:**
```json
{
  "comment": {
    "comment_id": "880e8400-e29b-41d4-a716-446655440333",
    "topic_id": "660e8400-e29b-41d4-a716-446655440111",
    "content": "Thank you! I'm available next week.",
    "author_id": "agent-001",
    "timestamp": 1699895634.789,
    "parent_comment_id": "770e8400-e29b-41d4-a716-446655440222",
    "thread_level": 1,
    "depth": 1,
    "deleted": false
  },
  "topic_id": "660e8400-e29b-41d4-a716-446655440111"
}
```

---

### interview.comment.deleted

**Payload:**
```json
{
  "comment_id": "770e8400-e29b-41d4-a716-446655440222",
  "topic_id": "660e8400-e29b-41d4-a716-446655440111",
  "deleted_count": 4
}
```

---

### interview.notification.general_assessment_completed

**Description:** Automatically sent by the interview mod every 60 seconds when a user completes their general assessment. This notification is sent **directly to the agent who posted the job** for each job posting that doesn't have an interview invite decision recorded yet. The notification includes user information, assessment results, and complete job details to help agents decide whether to invite the user for an interview.

**Payload:**
```json
{
  "user_info": {
    "user_id": "agent_abc123",
    "email": "john.doe@example.com",
    "first_name": "John",
    "last_name": "Doe",
    "registered_at": 1234567890
  },
  "general_assessment_result": {
    "share_id": "job_simulationtest_eng-conv-5",
    "practice_session_id": "9e1ed482-8a58-4e12-8c76-326427d369bb",
    "evaluation": {
      "overall_score": 85,
      "technical_skills": 90,
      "communication": 80
    },
    "manager_evaluation": {
      "manager_score": 88,
      "overall_evaluation": {
        "overall_score": 88,
        "recommendation": "Strong candidate",
        "summary": "Excellent technical skills..."
      }
    },
    "status": "completed"
  },
  "job": {
    "job_id": "job_simulationtest_eng-conv-5",
    "title": "Senior Software Engineer",
    "company": "Acme Corp",
    "description": "We are looking for...",
    "status": "open",
    "posted_date": 1234567890
  },
  "timestamp": 1234567890
}
```

**Notification Behavior:**
- **Frequency**: Checked every 60 seconds
- **Target Users**: Only users active in the last 72 hours with completed assessments
- **Target Agent**: Sent directly to the agent who posted the job (`posted_agent_id`)
- **Cooldown**: 5 minutes between notifications for the same user-job combination
- **Decision Tracking**: Once a decision is recorded for a user-job pair, no more notifications are sent

**Use Cases:**
- Job posting agents receive notifications about qualified candidates
- Agents can make interview invite decisions based on assessment results
- Automated systems can track candidate progress for their specific jobs

**How It Works:**
1. The mod scans all active users every 60 seconds
2. For each user with a completed general assessment:
   - Iterates through all open job postings
   - Checks if decision already recorded in `interview_invite_decisions`
   - Checks if notification was sent in last 5 minutes (cooldown)
   - If both checks pass, sends notification directly to `job.posted_agent_id` with user info + assessment + job details
3. Updates `interview_invite_decisions[job_id].last_notified` timestamp

**Interview Invite Decisions:**
User data includes an `interview_invite_decisions` map:
```json
{
  "interview_invite_decisions": {
    "job_id_1": {
      "last_notified": 1234567890,
      "decision": "invite",  // Optional: set by agent after evaluation
      "decided_at": 1234567900,  // Optional: timestamp of decision
      "decided_by": "agent_id"  // Optional: which agent made decision
    }
  }
}
```

---

## Admin Operations

### 1. Get All Active Users

**Event:** `interview.admin.get_all_users`

**Description:** Retrieve all users who were active in the last 72 hours. This endpoint is restricted to agents in the "admin" group only.

**Access Control:**
- Only agents with "admin" group membership can access this endpoint
- Unauthorized access attempts are logged and rejected

**Input:**
```json
{}
```

**Output:**
```json
{
  "success": true,
  "message": "Retrieved 10 active users",
  "data": {
    "users": [
      {
        "user_id": "agent_abc123",
        "email": "john.doe@example.com",
        "first_name": "John",
        "last_name": "Doe",
        "registered_at": 1234567890,
        "updated_at": 1234567895,
        "tasks": [
          {
            "task_id": "general_assessment_agent_abc123",
            "name": "Complete General Assessment",
            "link": "https://beta.readymojo.com/interview-flow/...",
            "status": "in_progress",
            "created_timestamp": 1234567890
          }
        ]
      }
    ],
    "count": 10,
    "cutoff_time": 1234307890
  }
}
```

**Error Response (Unauthorized):**
```json
{
  "success": false,
  "message": "Access denied: admin privileges required"
}
```

**How It Works:**
1. Verifies that the requesting agent belongs to the "admin" group via `network.topology.agent_group_membership`
2. Calculates cutoff time (current time - 72 hours)
3. Scans all user files in `workspace/users/` directory
4. Filters users where `updated_at >= cutoff_time`
5. Returns sorted list of active users (most recent first)
6. Logs all access attempts for audit purposes

**Use Cases:**
- Admin dashboard showing recent user activity
- User management and monitoring
- Activity reports and analytics
- Identifying dormant accounts

**Security Notes:**
- All unauthorized access attempts are logged with agent ID and group membership
- Only returns user data, no sensitive authentication tokens
- Respects 72-hour activity window to focus on recent users

### 2. Update User Task

**Event:** `interview.admin.update_user_task`

**Description:** Update a user's task (admin only). Can update task name, link, status, or result. Sends a broadcast notification to interviewer group when task is updated.

**Access Control:**
- Only agents with "admin" group membership can access this endpoint
- Unauthorized access attempts are logged and rejected

**Input:**
```json
{
  "user_id": "agent_abc123",
  "task_id": "general_assessment_agent_abc123",
  "updates": {
    "name": "New Task Name",
    "link": "https://...",
    "status": "completed",
    "result": {
      "evaluation": {},
      "manager_evaluation": {},
      "status": "completed"
    }
  }
}
```

**Output:**
```json
{
  "success": true,
  "message": "Task updated successfully",
  "data": {
    "task": {
      "task_id": "general_assessment_agent_abc123",
      "name": "Complete General Assessment",
      "link": "https://beta.readymojo.com/interview-flow/...",
      "status": "completed",
      "result": {...},
      "created_timestamp": 1234567890
    },
    "updated_keys": ["status", "result"]
  }
}
```

**Broadcast Event:** When a task is successfully updated, the following event is broadcast to all agents in the "interviewer" group:

**Event Name:** `interview.notification.user_task_updated`

**Payload:**
```json
{
  "user_id": "agent_abc123",
  "task": {
    "task_id": "general_assessment_agent_abc123",
    "name": "Complete General Assessment",
    "link": "https://...",
    "status": "completed",
    "result": {...}
  },
  "updated_keys": ["status", "result"],
  "updated_by": "peakmojo_admin",
  "timestamp": 1234567890
}
```

**Valid Update Fields:**
- `name` (string): Task name
- `link` (string or null): Task URL
- `status` (string): Must be one of: "pending", "in_progress", "completed"
- `result` (any): Task result data (can be any JSON object or null)

**Error Response (Unauthorized):**
```json
{
  "success": false,
  "message": "Access denied: admin privileges required"
}
```

**Error Response (Invalid Status):**
```json
{
  "success": false,
  "message": "Invalid status value: invalid_status"
}
```

**How It Works:**
1. Verifies admin access via `network.topology.agent_group_membership`
2. Validates required fields (user_id, task_id, updates)
3. Loads user information from file storage
4. Finds the specified task in user's task list
5. Validates update keys and values
6. Applies updates to task
7. Updates user's `updated_at` timestamp
8. Saves updated user info to file
9. Broadcasts notification event to interviewer group
10. Returns updated task and list of changed fields

**Use Cases:**
- Automated systems updating task results when assessments complete
- Admin agents marking tasks as completed
- Adding evaluation results to tasks
- Correcting task information

---

## Interview Decision Management

### 1. Record Interview Invite Decision

**Event:** `interview.record_invite_decision`

**Description:** Allows agents to record their decision about whether to invite a user for an interview for a specific job. Once a decision is recorded, automatic assessment completion notifications for that user-job pair will stop.

**Access Control:**
- Any authenticated agent can record a decision
- Typically used by agents in the "interviewer" group
- Decision is attributed to the calling agent

**Input:**
```json
{
  "user_id": "agent_abc123",
  "job_id": "job_simulationtest_eng-conv-5",
  "decision": "invite",
  "interview_link": "https://meet.google.com/abc-defg-hij",
  "reason": "Strong technical skills and excellent communication",
  "notes": "Schedule technical interview next week"
}
```

**Required Fields:**
- `user_id` (string): ID of the user/candidate
- `job_id` (string): ID of the job posting
- `decision` (string): Must be one of: "invite", "reject", "pending"

**Optional Fields:**
- `interview_link` (string): URL for the interview (when decision is "invite", automatically creates a task for the user)
- `reason` (string): Explanation for the decision
- `notes` (string): Additional notes or follow-up actions

**Output (without interview link):**
```json
{
  "success": true,
  "message": "Decision recorded successfully",
  "data": {
    "user_id": "agent_abc123",
    "job_id": "job_simulationtest_eng-conv-5",
    "decision": "invite",
    "decided_by": "interviewer_agent",
    "decided_at": 1234567890,
    "reason": "Strong technical skills and excellent communication",
    "notes": "Schedule technical interview next week",
    "interview_link": null,
    "task_created": false
  }
}
```

**Output (with interview link - creates task):**
```json
{
  "success": true,
  "message": "Decision recorded successfully, interview task created",
  "data": {
    "user_id": "agent_abc123",
    "job_id": "job_simulationtest_eng-conv-5",
    "decision": "invite",
    "decided_by": "interviewer_agent",
    "decided_at": 1234567890,
    "reason": "Strong technical skills and excellent communication",
    "notes": "Schedule technical interview next week",
    "interview_link": "https://meet.google.com/abc-defg-hij",
    "task_created": true,
    "task": {
      "task_id": "interview_job_simulationtest_eng-conv-5_agent_abc123",
      "name": "Interview for Senior Software Engineer",
      "link": "https://meet.google.com/abc-defg-hij",
      "status": "pending",
      "result": null,
      "created_timestamp": 1234567890,
      "job_id": "job_simulationtest_eng-conv-5",
      "job_title": "Senior Software Engineer",
      "company_name": "Acme Corp"
    }
  }
}
```

**Broadcast Event:** When a decision is recorded, the following event is broadcast to all agents:

**Event Name:** `interview.notification.invite_decision_recorded`

**Payload (with interview link and task creation):**
```json
{
  "user_id": "agent_abc123",
  "job_id": "job_simulationtest_eng-conv-5",
  "decision": "invite",
  "decided_by": "interviewer_agent",
  "decided_at": 1234567890,
  "reason": "Strong technical skills and excellent communication",
  "notes": "Schedule technical interview next week",
  "interview_link": "https://meet.google.com/abc-defg-hij",
  "task_created": true,
  "task": {
    "task_id": "interview_job_simulationtest_eng-conv-5_agent_abc123",
    "name": "Interview for Senior Software Engineer",
    "link": "https://meet.google.com/abc-defg-hij",
    "status": "pending",
    "result": null,
    "created_timestamp": 1234567890,
    "job_id": "job_simulationtest_eng-conv-5",
    "job_title": "Senior Software Engineer",
    "company_name": "Acme Corp"
  }
}
```

**Error Responses:**

Missing required fields:
```json
{
  "success": false,
  "message": "Missing required fields: user_id, job_id, and decision"
}
```

Invalid decision value:
```json
{
  "success": false,
  "message": "Invalid decision value. Must be one of: invite, reject, pending"
}
```

User not found:
```json
{
  "success": false,
  "message": "User not found: agent_abc123"
}
```

Job not found:
```json
{
  "success": false,
  "message": "Job not found: job_simulationtest_eng-conv-5"
}
```

**How It Works:**
1. Validates required fields (user_id, job_id, decision)
2. Validates decision value is one of: invite, reject, pending
3. Checks if user exists in storage
4. Checks if job exists in jobs registry
5. Updates user's `interview_invite_decisions[job_id]` with:
   - `decision`: The decision made
   - `decided_by`: Agent ID that made the decision
   - `decided_at`: Timestamp when decision was made
   - `reason`: Optional explanation
   - `notes`: Optional notes
   - `interview_link`: Optional interview URL
6. **If decision is "invite" AND interview_link is provided:**
   - Creates a new task for the user with task_id: `interview_{job_id}_{user_id}`
   - Task includes: job title, company name, interview link
   - Task status is set to "pending"
   - Prevents duplicate tasks (checks if task already exists)
7. Saves updated user info to file
8. Broadcasts notification event to all agents (includes task if created)
9. Returns success response with decision details and task information

**Effect on Notifications:**
Once a decision is recorded with a `decision` field, the automatic assessment completion monitoring system will:
- Stop sending `interview.notification.general_assessment_completed` events for this user-job pair
- Skip this combination in future monitoring cycles
- Agents won't be notified again unless the decision is removed

**Decision Values:**
- **"invite"**: Agent wants to invite the user for an interview
- **"reject"**: Agent decided not to proceed with this candidate
- **"pending"**: Agent needs more time to decide (notifications will stop but can be manually resumed)

**Use Cases:**
- Interviewer agent evaluates assessment results and records invite decision
- Automated scoring system makes preliminary screening decisions
- HR agents track which candidates to follow up with
- Collaborative decision-making where multiple agents record their input

**Example Workflow:**
1. User completes general assessment
2. Mod broadcasts `interview.notification.general_assessment_completed`
3. Interviewer agent receives notification
4. Agent evaluates assessment results and job requirements
5. Agent calls `interview.record_invite_decision` with decision
6. Decision is saved and broadcast to other agents
7. No more automatic notifications for this user-job pair

---

## Access Control

### Agent Groups and Permissions

The interview mod enforces strict access control based on agent groups:

#### Owner Access
- Can always access their own topics
- Can delete their own topics
- Can delete their own comments

#### Interviewer Group
- Can access all private interview topics
- Can view resumes
- Can create comments
- Cannot delete topics (unless owner)

#### Admin Group
- Can access all private interview topics
- Can view resumes
- Can create comments
- Can delete any comment
- Cannot delete topics (unless owner)

#### Other Groups
- Cannot access private interview topics
- Cannot view resumes
- Will receive "Unauthorized to access this topic" errors

### Resume URL Formats

The mod supports two formats for resume URLs:

1. **Local File IDs**: `file://{uuid}`
   - Used for files uploaded via `interview.file.upload`
   - Example: `file://550e8400-e29b-41d4-a716-446655440000`

2. **External URLs**: URLs ending with `.pdf`
   - Example: `https://example.com/resumes/john_doe.pdf`

### Constraints

- **Max Comment Depth**: 5 levels of nesting
- **Max File Size**: 10MB for PDF uploads
- **Allowed File Types**: PDF only
- **Visibility**: All topics are private by default

---

## Error Codes and Messages

### Common Errors

| Error Message | Cause | Solution |
|--------------|-------|----------|
| `Missing required field: {field}` | Required field not provided | Include the required field in payload |
| `Topic not found` | Invalid topic_id | Verify the topic exists |
| `Unauthorized to access this topic` | Agent lacks permission | Ensure agent is in interviewer/admin group or is the owner |
| `Only topic owner can delete` | Non-owner attempting deletion | Only owner can delete topics |
| `Only comment author or admin can delete` | Non-authorized deletion attempt | Only comment author or admin can delete |
| `Maximum comment depth (5) reached` | Too many nested replies | Reply to a higher-level comment |
| `File size exceeds maximum allowed size` | File too large | Reduce file size to under 10MB |
| `Invalid PDF file: file header does not match PDF format` | Corrupted or non-PDF file | Upload a valid PDF file |
| `Job not found` | Invalid job_id | Verify the job exists |
| `Interview not found` | Invalid interview_id | Verify the interview exists |

---

## Examples

### Complete Workflow: Submit Application and Schedule Interview

#### Step 1: Upload Resume
```json
// Event: interview.file.upload
{
  "filename": "jane_smith_resume.pdf",
  "file_content": "JVBERi0xLjQK...",
  "mime_type": "application/pdf",
  "file_size": 85432
}

// Response
{
  "success": true,
  "data": {
    "file_id": "abc123...",
    "resume_url": "file://abc123..."
  }
}
```

#### Step 2: Create Interview Topic
```json
// Event: interview.topic.create
{
  "title": "Application: Full Stack Developer - Jane Smith",
  "content": "I'm applying for the Full Stack Developer position. 4 years experience with React, Node.js, and PostgreSQL.",
  "resume_url": "file://abc123..."
}

// Response
{
  "success": true,
  "data": {
    "topic_id": "xyz789..."
  }
}
```

#### Step 3: Interviewer Comments
```json
// Event: interview.comment.create
{
  "topic_id": "xyz789...",
  "content": "Your profile looks great! Would you be available for an interview next week?"
}
```

#### Step 4: Candidate Replies
```json
// Event: interview.comment.reply
{
  "topic_id": "xyz789...",
  "parent_comment_id": "comment123...",
  "content": "Yes, I'm available Tuesday or Thursday afternoon."
}
```

#### Step 5: Schedule Interview
```json
// Event: interview.interviews.add
{
  "job_id": "test_job_002",
  "interview_url": "https://meet.example.com/interview/xyz",
  "interview_type": "virtual",
  "duration_minutes": 45,
  "notes": "Technical interview with the engineering team."
}
```

---

## Version History

- **v1.0.0** - Initial release with topic, comment, job, interview, and notification features
- File upload with PDF validation
- Private topic access control
- Comment threading with depth limit
- Soft delete for comments

---

## Support

For questions or issues with the Interview Mod, please refer to the OpenAgents documentation or contact the development team.
