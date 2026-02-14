# Firebase Integration for MaxBot Kanban Tracker

## Overview
This guide walks you through setting up Firebase for persistent data storage, user authentication, and real-time sync.

## Prerequisites
- Firebase project (create one at https://console.firebase.google.com)
- Basic understanding of Firebase Console

## Step 1: Create Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Click "Add project"
3. Name it (e.g., "maxbot-kanban")
4. Accept defaults, create project
5. Once created, go to **Project Settings** (gear icon)

## Step 2: Get Firebase Config

1. In Project Settings, find your web app config
2. Copy the configuration object
3. Create `firebase-config.js` from `firebase-config.example.js`
4. Paste your config values

```javascript
export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

## Step 3: Enable Firestore Database

1. In Firebase Console, go to **Firestore Database**
2. Click "Create database"
3. Start in **test mode** (for development)
4. Choose region closest to you
5. Create

### Firestore Security Rules (Production)
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /tasks/{document=**} {
      allow read, write: if request.auth.uid == resource.data.userId;
      allow create: if request.auth.uid == request.resource.data.userId;
    }
  }
}
```

## Step 4: Enable Authentication

1. In Firebase Console, go to **Authentication**
2. Click "Get started"
3. Enable **Email/Password** provider
4. Optional: Enable Google, GitHub, etc.

## Step 5: Update index.html

Add Firebase imports and initialize the Kanban class:

```html
<!-- Add to <head> -->
<script type="module">
  import kanban from './firebase-kanban.js';
  window.kanban = kanban;
</script>
```

## Step 6: Add Auth UI (Optional)

Modify `index.html` to add login/logout buttons:

```html
<div class="auth-container">
  <div id="auth-ui" style="display: none;">
    <input type="email" id="email" placeholder="Email">
    <input type="password" id="password" placeholder="Password">
    <button onclick="handleLogin()">Login</button>
    <button onclick="handleSignup()">Sign Up</button>
  </div>
  <div id="user-info" style="display: none;">
    <span id="user-email"></span>
    <button onclick="handleLogout()">Logout</button>
  </div>
</div>
```

## Step 7: Connect Data Flow

Update task management to use Firebase:

```javascript
// When user logs in
kanban.onTasksChange((tasks) => {
  renderBoard(tasks);
});

// When adding a task
await kanban.addTask({
  title: taskTitle,
  status: 'todo',
  assignee: null,
  priority: 'medium',
  dueDate: null,
  description: ''
});

// When moving a task
await kanban.updateTask(taskId, { status: newStatus });
```

## Data Structure

Tasks in Firestore:
```json
{
  "id": "auto-generated",
  "title": "Implement Firebase",
  "status": "in-progress",
  "assignee": "user@example.com",
  "priority": "high",
  "dueDate": "2026-02-28",
  "description": "Add persistent storage",
  "userId": "firebase-uid",
  "createdAt": "2026-02-14T09:00:00Z",
  "updatedAt": "2026-02-14T10:00:00Z"
}
```

## Deployment

1. Commit changes: `git add . && git commit -m "feat: Add Firebase integration"`
2. Push to main: `git push origin feature/firebase-integration`
3. Merge to main: Create PR on GitHub
4. Vercel auto-deploys on merge
5. Update `firebase-config.js` in production (or use environment variables)

## Environment Variables (Recommended)

For production, use Vercel environment variables instead of hardcoding:

1. Go to Vercel project settings
2. Add environment variables:
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - etc.

3. Update `firebase-config.js`:
```javascript
export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  // ...
};
```

## Testing

1. Deploy to Vercel
2. Create an account
3. Add a task
4. Refresh the page (data should persist)
5. Log out and back in (should see your tasks)

## Troubleshooting

- **"Permission denied" errors**: Check Firestore security rules
- **Firebase not initializing**: Verify `firebase-config.js` credentials
- **Tasks not syncing**: Check browser console for errors
- **Authentication failing**: Ensure Email/Password is enabled in Firebase Console

## Next Steps

- [ ] Add filter by assignee/priority
- [ ] Add due date reminders (Cloud Functions)
- [ ] Add shared board access (multiple users)
- [ ] Add task comments
- [ ] Add file attachments
