# Contact Support Feature Setup

## Overview
The Contact Support feature allows users to submit support tickets directly from the app.

## Backend Setup

### 1. Run Database Migration
```bash
psql -d your_database -f migrations/create_support_tickets_table.sql
```

### 2. Restart Server
The support routes are already integrated. Just restart:
```bash
npm start
```

## API Endpoints

### POST /support/contact
Submit a support request

**Request:**
```json
{
  "subject": "Issue with profile",
  "message": "I can't update my profile picture"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Your support request has been submitted successfully",
  "ticket_id": "uuid-here"
}
```

### GET /support/tickets
Get all support tickets for the current user

**Response:**
```json
[
  {
    "id": "uuid",
    "user_id": "user123",
    "subject": "Issue with profile",
    "message": "I can't update my profile picture",
    "status": "open",
    "admin_response": null,
    "created_at": "2026-03-08T12:00:00Z",
    "updated_at": "2026-03-08T12:00:00Z",
    "resolved_at": null
  }
]
```

### GET /support/tickets/:ticketId
Get details of a specific ticket

## Email Notifications (Optional)

To send email notifications when tickets are created, add one of these services:

### Option 1: SendGrid
```bash
npm install @sendgrid/mail
```

```javascript
// In support.routes.js after ticket creation
const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const msg = {
  to: 'support@yourapp.com',
  from: 'noreply@yourapp.com',
  subject: `New Support Ticket: ${subject}`,
  text: `User: ${userId}\nSubject: ${subject}\nMessage: ${message}`,
  html: `<strong>User:</strong> ${userId}<br><strong>Subject:</strong> ${subject}<br><strong>Message:</strong> ${message}`,
};

await sgMail.send(msg);
```

### Option 2: Nodemailer
```bash
npm install nodemailer
```

```javascript
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  }
});

await transporter.sendMail({
  from: 'noreply@yourapp.com',
  to: 'support@yourapp.com',
  subject: `New Support Ticket: ${subject}`,
  text: `User: ${userId}\nSubject: ${subject}\nMessage: ${message}`
});
```

## Testing

1. Open the app and navigate to Settings > Contact Support
2. Fill in subject and message
3. Submit the form
4. Check the database:
```sql
SELECT * FROM support_tickets ORDER BY created_at DESC LIMIT 5;
```

## Admin Panel (Future Enhancement)

You can build an admin panel to:
- View all support tickets
- Update ticket status
- Add admin responses
- Filter by status (open, in_progress, resolved, closed)

Example query for admin:
```sql
SELECT 
  st.*,
  u.first_name,
  u.last_name,
  u.email
FROM support_tickets st
JOIN users u ON st.user_id = u.id
WHERE st.status = 'open'
ORDER BY st.created_at DESC;
```

## Status Workflow

1. **open** - New ticket submitted
2. **in_progress** - Support team is working on it
3. **resolved** - Issue has been resolved
4. **closed** - Ticket is closed (no further action)

The `resolved_at` timestamp is automatically set when status changes to resolved or closed.
