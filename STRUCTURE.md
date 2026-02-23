# Project Structure Overview

## Directory Layout

```
rollmate-server/
│
├── config/
│   └── index.js                    # Supabase client configuration
│
├── src/
│   ├── middleware/
│   │   ├── auth.js                # Firebase authentication middleware
│   │   ├── errorHandler.js        # Global error handler
│   │   └── upload.js              # Multer file upload configurations
│   │
│   ├── routes/
│   │   ├── achievement.routes.js  # Achievement CRUD & verifications
│   │   ├── auth.routes.js         # Login/logout endpoints
│   │   ├── chat.routes.js         # Chat messages & image uploads
│   │   ├── news.routes.js         # BJJ news RSS feed trigger
│   │   ├── post.routes.js         # Posts, likes, comments
│   │   ├── roll.routes.js         # Roll requests & responses
│   │   ├── user.routes.js         # User management & profiles
│   │   └── index.js               # Route aggregator
│   │
│   ├── services/
│   │   ├── firebase.js            # Firebase Admin SDK initialization
│   │   ├── notification.js        # FCM push notifications
│   │   └── rss.js                 # BJJ news RSS feed parser
│   │
│   ├── app.js                     # Express app setup & middleware
│   └── server.js                  # Server entry point
│
├── models/                         # (Empty - for future use)
├── uploads/                        # Temporary file storage
│
├── .env.example                    # Environment variables template
├── .gitignore                      # Git ignore rules
├── package.json                    # Dependencies & scripts
├── README.md                       # Project documentation
├── MIGRATION.md                    # Migration guide
└── STRUCTURE.md                    # This file
```

## File Responsibilities

### Middleware Layer
- **auth.js**: Verifies Firebase JWT tokens, attaches user to request
- **errorHandler.js**: Catches and formats all errors
- **upload.js**: Configures multer for profile pics, chat images, post media

### Route Layer
Each route file handles a specific domain:
- **achievement.routes.js**: 7 endpoints for achievements & verifications
- **auth.routes.js**: 2 endpoints for login/logout
- **chat.routes.js**: 2 endpoints for messaging
- **news.routes.js**: 1 endpoint to manually trigger news fetch
- **post.routes.js**: 10 endpoints for posts, likes, comments
- **roll.routes.js**: 3 endpoints for roll requests
- **user.routes.js**: 10 endpoints for user management

### Service Layer
- **firebase.js**: Initializes Firebase Admin SDK
- **notification.js**: Sends FCM push notifications
- **rss.js**: Fetches and posts BJJ news from RSS feeds

### Application Layer
- **app.js**: Configures Express, mounts routes, schedules cron jobs
- **server.js**: Starts the HTTP server

## Request Flow

```
Client Request
    ↓
server.js (HTTP Server)
    ↓
app.js (Express App)
    ↓
middleware/auth.js (Authentication)
    ↓
routes/index.js (Route Dispatcher)
    ↓
routes/*.routes.js (Specific Route Handler)
    ↓
services/*.js (Business Logic)
    ↓
config/index.js (Database Client)
    ↓
Supabase Database
    ↓
Response to Client
```

## Key Improvements

1. **Modularity**: Each file has a single, clear purpose
2. **Scalability**: Easy to add new routes or services
3. **Maintainability**: Changes are isolated to specific files
4. **Testability**: Individual modules can be unit tested
5. **Readability**: Clear naming and organization
6. **Industry Standard**: Follows Express.js best practices

## Adding New Features

### New Route
1. Create `src/routes/feature.routes.js`
2. Import and mount in `src/routes/index.js`

### New Service
1. Create `src/services/feature.js`
2. Import in relevant route files

### New Middleware
1. Create `src/middleware/feature.js`
2. Apply in `src/app.js` or specific routes
