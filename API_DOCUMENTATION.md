# Google Places API Business Scraper - REST API Documentation

Base URL: `http://localhost:3000/api`

## Authentication Endpoints

### POST /api/auth/register
Register a new user account.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response (201):**
```json
{
  "message": "User registered successfully",
  "token": "jwt_token_here",
  "user": {
    "id": 1,
    "email": "user@example.com",
    "tier": "free"
  }
}
```

### POST /api/auth/login
Login with existing credentials.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response (200):**
```json
{
  "message": "Login successful",
  "token": "jwt_token_here",
  "user": {
    "id": 1,
    "email": "user@example.com",
    "tier": "free"
  }
}
```

### POST /api/auth/logout
Logout user (client-side token removal).

**Response (200):**
```json
{
  "message": "Logout successful"
}
```

### POST /api/auth/validate-api-key
Validate a Google Places API key.

**Request Body:**
```json
{
  "apiKey": "your_google_api_key"
}
```

**Response (200):**
```json
{
  "valid": true,
  "message": "API key is valid"
}
```

## User Management Endpoints

### GET /api/user/profile
Get user profile information. **Requires Authentication**

**Headers:**
```
Authorization: Bearer {jwt_token}
```

**Response (200):**
```json
{
  "id": 1,
  "email": "user@example.com",
  "tier": "free",
  "createdAt": "2025-09-30T22:33:00.853Z",
  "hasApiKey": false
}
```

### PUT /api/user/api-key
Save encrypted Google API key. **Requires Authentication**

**Headers:**
```
Authorization: Bearer {jwt_token}
```

**Request Body:**
```json
{
  "apiKey": "your_google_api_key"
}
```

**Response (200):**
```json
{
  "message": "API key saved successfully"
}
```

### GET /api/user/usage-stats
Get API usage statistics. **Requires Authentication**

**Headers:**
```
Authorization: Bearer {jwt_token}
```

**Response (200):**
```json
{
  "totalSearches": 5,
  "totalApiCalls": 150,
  "lastSearchDate": "2025-09-30T22:33:00.853Z",
  "recentUsage": [
    {
      "search_date": "2025-09-30T22:33:00.853Z",
      "api_calls_made": 50
    }
  ]
}
```

## Search Endpoints

### POST /api/search/execute
Execute a business search. **Requires Authentication**

**Headers:**
```
Authorization: Bearer {jwt_token}
```

**Request Body:**
```json
{
  "state": "CA",
  "city": "Los Angeles",
  "zipCodes": ["90210", "90211"],
  "keywords": ["restaurant", "italian"],
  "keywordLogic": "AND",
  "categories": ["restaurant"],
  "resultsLimit": 100
}
```

**Response (200):**
```json
{
  "results": [
    {
      "name": "Business Name",
      "address": "123 Main St, Los Angeles, CA 90210",
      "phone": "(555) 123-4567",
      "website": "https://example.com",
      "rating": 4.5,
      "reviewCount": 250,
      "hours": ["Monday: 9:00 AM – 5:00 PM", "..."],
      "photoUrls": ["https://maps.googleapis.com/..."],
      "placeId": "ChIJ...",
      "latitude": 34.0522,
      "longitude": -118.2437
    }
  ],
  "totalResults": 25,
  "apiCallsUsed": 50,
  "estimatedCost": "0.85"
}
```

### POST /api/search/save
Save search criteria for later use. **Requires Authentication**

**Headers:**
```
Authorization: Bearer {jwt_token}
```

**Request Body:**
```json
{
  "searchName": "LA Italian Restaurants",
  "searchCriteria": {
    "state": "CA",
    "city": "Los Angeles",
    "zipCodes": ["90210"],
    "keywords": ["italian", "restaurant"],
    "keywordLogic": "AND",
    "categories": ["restaurant"],
    "resultsLimit": 100
  }
}
```

**Response (201):**
```json
{
  "message": "Search saved successfully",
  "searchId": 1
}
```

### GET /api/search/saved
Get all saved searches. **Requires Authentication**

**Headers:**
```
Authorization: Bearer {jwt_token}
```

**Response (200):**
```json
{
  "searches": [
    {
      "id": 1,
      "searchName": "LA Italian Restaurants",
      "state": "CA",
      "city": "Los Angeles",
      "zipCodes": ["90210"],
      "keywords": ["italian", "restaurant"],
      "keywordLogic": "AND",
      "categories": ["restaurant"],
      "resultsLimit": 100,
      "createdAt": "2025-09-30T22:33:00.853Z"
    }
  ]
}
```

### DELETE /api/search/:id
Delete a saved search. **Requires Authentication**

**Headers:**
```
Authorization: Bearer {jwt_token}
```

**Response (200):**
```json
{
  "message": "Search deleted successfully"
}
```

## Export Endpoints

### POST /api/export/csv
Export search results to CSV. **Requires Authentication**

**Headers:**
```
Authorization: Bearer {jwt_token}
Content-Type: application/json
```

**Request Body:**
```json
{
  "results": [
    {
      "name": "Business Name",
      "address": "123 Main St",
      "phone": "(555) 123-4567",
      "website": "https://example.com",
      "rating": 4.5,
      "reviewCount": 250,
      "hours": ["Monday: 9:00 AM – 5:00 PM"],
      "photoUrls": ["https://maps.googleapis.com/..."],
      "placeId": "ChIJ...",
      "latitude": 34.0522,
      "longitude": -118.2437
    }
  ]
}
```

**Response (200):**
Returns CSV file with headers:
- Business Name, Address, Phone, Website, Rating, Review Count, Hours, Photo URLs, Place ID, Latitude, Longitude

## Error Responses

All endpoints return appropriate HTTP status codes:

- **400 Bad Request**: Invalid input data
- **401 Unauthorized**: Missing or invalid JWT token
- **404 Not Found**: Resource not found
- **500 Internal Server Error**: Server error

Example error response:
```json
{
  "error": "Error message here"
}
```

## CORS Configuration

The API has CORS enabled to allow requests from any origin. In production, configure specific origins for security.

## Security Features

- JWT-based authentication with 7-day token expiration
- Password hashing using bcrypt
- AES-256 encryption for Google API keys
- Input validation using express-validator
- SQL injection protection via parameterized queries
