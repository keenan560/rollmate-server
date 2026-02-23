# RollMate Server

A Node.js/Express backend for the RollMate BJJ social platform.

## Project Structure

```
├── config/                 # Configuration files
│   └── index.js           # Supabase configuration
├── src/
│   ├── middleware/        # Express middleware
│   │   ├── auth.js       # Firebase authentication
│   │   ├── errorHandler.js
│   │   └── upload.js     # Multer file upload configs
│   ├── routes/           # API route handlers
│   │   ├── achievement.routes.js
│   │   ├── auth.routes.js
│   │   ├── chat.routes.js
│   │   ├── news.routes.js
│   │   ├── post.routes.js
│   │   ├── roll.routes.js
│   │   ├── user.routes.js
│   │   └── index.js      # Route aggregator
│   ├── services/         # Business logic & external services
│   │   ├── firebase.js   # Firebase Admin SDK
│   │   ├── notification.js
│   │   └── rss.js        # BJJ news RSS feed
│   ├── app.js            # Express app setup
│   └── server.js         # Server entry point
├── uploads/              # Temporary file uploads
├── models/               # Database models (if needed)
├── index.js              # Legacy file (to be removed)
└── package.json
```

## Getting Started

### Installation

```bash
npm install
```

### Running the Server

```bash
# Production
npm start

# Development (with nodemon)
npm run dev
```

## API Routes

### Authentication
- `POST /login` - User login
- `POST /logout` - User logout

### Users
- `GET /check-user` - Check if user exists
- `POST /register` - Register new user
- `GET /users` - Get all users (with filters)
- `GET /users/:userId` - Get single user
- `GET /user-profile` - Get current user profile
- `POST /update-profile` - Update user profile
- `PUT /profile/playing-style` - Update playing style
- `POST /deleteUser` - Delete user account
- `GET /find-match` - Find potential matches
- `POST /profile-pics` - Upload profile picture

### Roll Requests
- `POST /roll-request` - Send roll request
- `GET /roll-requests` - Get all roll requests
- `POST /roll-request/:requestId/respond` - Respond to request

### Chat
- `POST /chat-messages` - Send message
- `GET /chat-messages/:rollRequestId` - Get messages

### Posts
- `GET /posts` - Get feed
- `POST /posts` - Create text post
- `POST /posts/image` - Create post with image
- `POST /posts/video` - Create post with video
- `POST /posts/youtube` - Create post with YouTube video
- `POST /posts/:postId/like` - Like post
- `DELETE /posts/:postId/like` - Unlike post
- `GET /posts/:postId/comments` - Get comments
- `POST /posts/:postId/comments` - Add comment
- `DELETE /posts/:postId` - Delete post

### Achievements
- `GET /achievements/:userId` - Get user achievements
- `POST /achievements` - Create achievement
- `PUT /achievements/:achievementId` - Update achievement
- `DELETE /achievements/:achievementId` - Delete achievement
- `POST /achievements/:achievementId/verify` - Verify achievement
- `DELETE /achievements/:achievementId/verify` - Unverify achievement
- `GET /achievements/:achievementId/verifications` - Get verifications

### News
- `GET /fetch-bjj-news` - Manually trigger news fetch

## Environment Variables

Create a `.env` file with:

```
PORT=3001
```

## Technologies

- Express.js
- Firebase Admin SDK
- Supabase
- Multer (file uploads)
- node-cron (scheduled tasks)
- rss-parser (BJJ news feeds)
