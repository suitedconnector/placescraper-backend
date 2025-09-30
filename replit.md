# Google Places API Business Scraper

## Overview

A REST API application that enables users to scrape and export business listings from the Google Places API. The application implements a freemium tier-based model where users can search for businesses by location (state, city, or zip codes) and keywords, with configurable search criteria and multiple export formats. The system securely stores user-provided Google API keys and tracks API usage per user.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Backend Architecture

**Framework & Runtime**
- Node.js/Express REST API server
- Port configuration via environment variables (default: 3000)
- CORS enabled for cross-origin requests
- Centralized error handling middleware

**Authentication & Authorization**
- JWT-based authentication with 7-day token expiration
- Bearer token authentication for protected endpoints
- Password hashing using bcrypt (salt rounds: 10)
- Middleware-based route protection

**Database Design**
- PostgreSQL with connection pooling
- SSL enabled for production environments
- User table schema includes:
  - User credentials (email, password hash)
  - Tier-based access control (free tier default)
  - Encrypted Google API key storage
  - Timestamp tracking (created_at)

**Data Security**
- AES-256-CBC encryption for sensitive data (Google API keys)
- Environment-based encryption key with SHA-256 hashing
- IV (Initialization Vector) randomization per encryption operation
- Encrypted data format: `{iv}:{encrypted_data}`

**Request Validation**
- Express-validator for input sanitization
- Email normalization and format validation
- Password minimum length enforcement (6 characters)
- Array and enum validation for search parameters
- Results limit bounds enforcement (1-500, default 100)

### API Structure

**Endpoint Organization**
1. `/api/auth/*` - Authentication (register, login)
2. `/api/user/*` - User management (profile, API key configuration)
3. `/api/search/*` - Business search execution
4. `/api/export/*` - Data export (CSV format)
5. `/api/health` - Health check endpoint

**Search Functionality**
- Multi-location support (state, city, zip codes)
- Keyword-based filtering with AND/OR logic
- Category filtering using Google Places API types
- Configurable results limit (max 500)
- Location parameter validation (at least one required)

**Data Export**
- JSON to CSV conversion using json2csv
- Comprehensive field mapping:
  - Business details (name, address, phone, website)
  - Metrics (rating, review count)
  - Operational data (hours)
  - Media (photo URLs)
  - Geographic data (coordinates, place ID)
- Automatic file download headers

### External Dependencies

**Google Services Integration**
- `@googlemaps/google-maps-services-js` (v3.4.2) - Google Maps/Places API client
- User-provided API keys (stored encrypted)
- API key validation through actual API requests
- Usage tracking capability (mentioned in requirements)

**Security & Authentication**
- `jsonwebtoken` (v9.0.2) - JWT token generation and verification
- `bcrypt` (v6.0.0) - Password hashing
- `crypto` (Node.js built-in) - AES-256-CBC encryption

**Database**
- `pg` (v8.16.3) - PostgreSQL client with connection pooling
- Environment-based connection string configuration
- Production SSL support

**Data Processing**
- `json2csv` (v6.0.0-alpha.2) - CSV export generation
- `express-validator` (v7.2.1) - Request validation and sanitization

**Server Infrastructure**
- `express` (v5.1.0) - Web framework
- `cors` (v2.8.5) - CORS middleware
- `dotenv` (v17.2.3) - Environment variable management

**Environment Variables Required**
- `DATABASE_URL` - PostgreSQL connection string (auto-configured)
- `JWT_SECRET` - JWT signing secret (configured)
- `ENCRYPTION_KEY` - API key encryption secret (configured)
- `PORT` - Server port (optional, default 3000)
- `NODE_ENV` - Environment indicator (affects SSL configuration)

## Phase 1 MVP Status

**Completed Features:**
- ✅ User registration and login with JWT authentication
- ✅ Encrypted Google API key storage with AES-256
- ✅ Google API key validation endpoint
- ✅ User profile and usage statistics tracking
- ✅ Business search with Google Places API integration
- ✅ Multi-location search (state, city, zip codes)
- ✅ Keyword filtering with AND/OR logic
- ✅ Category filtering
- ✅ Save and manage search criteria
- ✅ CSV export with comprehensive business data
- ✅ Input validation and error handling
- ✅ CORS configuration for frontend integration
- ✅ PostgreSQL database with proper schema

**API Endpoints:**
- Authentication: `/api/auth/register`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/validate-api-key`
- User Management: `/api/user/profile`, `/api/user/api-key`, `/api/user/usage-stats`
- Search: `/api/search/execute`, `/api/search/save`, `/api/search/saved`, `/api/search/:id`
- Export: `/api/export/csv`
- Health: `/api/health`

**Documentation:**
- See `API_DOCUMENTATION.md` for complete endpoint documentation

**Next Phase (Phase 2 - Monetization):**
- Implement tier-based rate limiting
- Add Square payment integration
- Implement Pro tier features (unlimited results, Excel/JSON export)
- Add search result caching