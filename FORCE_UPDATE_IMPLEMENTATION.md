# Force Update Implementation

## Overview
Implemented a mandatory update mechanism that blocks all app screens when a new version is deployed, forcing users to update before they can continue using the app.

## How It Works

### 1. Version Checking
- **Initial Check**: On app load, checks if client version matches server version
- **Continuous Polling**: Checks for updates every 30 seconds while app is running
- **Endpoint**: `GET /api/version` returns `{ version: "2.0.1" }`

### 2. Version Configuration
- **Client Version**: Set in `fidel-bingo/frontend/.env` as `VITE_APP_VERSION`
- **Server Version**: Set in `fidel-bingo/backend/.env` as `APP_VERSION`
- **Default**: Falls back to `2.0.1` if not set

### 3. Blocking Overlay
When version mismatch is detected:
- Shows a **full-screen blocking overlay** (z-index: 9999)
- Cannot be dismissed or bypassed
- Prevents all user interactions with the app
- Displays prominent "Update Required" message with animated logo
- Shows update progress (10% → 30% → 60% → 80% → 90% → 100%)

### 4. Update Process
When user clicks "Update Now":
1. **Update Service Worker** (30%)
2. **Clear all caches** (60%) - removes outdated assets
3. **Unregister Service Worker** (80%) - prepares for fresh install
4. **Clear localStorage flags** (90%) - removes stale state
5. **Reload page** (100%) - fetches new version from server

### 5. Continuous Monitoring
- Even after initial load, continues checking for updates every 30 seconds
- If new version is deployed while user is actively using the app, they'll see the update screen within 30 seconds
- No way to skip or postpone the update

## Deployment Workflow

### To Deploy a New Version:

1. **Update Version Numbers**:
   ```bash
   # Frontend
   echo "VITE_APP_VERSION=2.0.2" >> fidel-bingo/frontend/.env
   
   # Backend
   echo "APP_VERSION=2.0.2" >> fidel-bingo/backend/.env
   ```

2. **Deploy Backend First**:
   - Deploy backend with new `APP_VERSION`
   - Server will start responding with new version number

3. **Deploy Frontend**:
   - Deploy frontend with matching `VITE_APP_VERSION`
   - Users with old version will immediately see update prompt

4. **User Experience**:
   - Users with v2.0.1 see the update screen
   - They click "Update Now"
   - App clears cache and reloads with v2.0.2
   - Can now use the app normally

## Testing the Feature

### Test Update Flow:
1. Set backend version to `2.0.2`: `APP_VERSION=2.0.2`
2. Keep frontend version at `2.0.1`: `VITE_APP_VERSION=2.0.1`
3. Start both servers
4. Open frontend - should immediately show update screen
5. Click "Update Now" - app reloads
6. Update frontend to `2.0.2` and rebuild
7. After reload, should work normally

### Test Continuous Checking:
1. Start app with matching versions (both 2.0.1)
2. App loads normally
3. While app is running, update backend to 2.0.2
4. Within 30 seconds, update screen appears
5. User must update to continue

## UI Features

### Update Screen Includes:
- ✅ Animated pulsing logo with glow effect
- ✅ Clear "Update Required" heading
- ✅ Warning message: "⚠️ You must update to continue using the app"
- ✅ Large prominent "Update Now" button
- ✅ Progress bar showing update steps (0-100%)
- ✅ Loading spinner during update
- ✅ Instructions to not close the window
- ✅ Full-screen overlay preventing any other interaction

### Visual Design:
- Dark gradient background (#0a1220 → #1a1f35)
- Backdrop blur for modern look
- Yellow/orange branding colors
- Smooth animations and transitions
- Mobile-responsive layout

## Benefits

1. **Instant Updates**: Users always get latest features and bug fixes
2. **No Stale Clients**: Prevents users from using outdated versions
3. **Bug Fix Propagation**: Critical fixes reach all users immediately
4. **Consistent Experience**: Everyone on the same version
5. **No User Choice Required**: Automatic enforcement

## Configuration

### Environment Variables:

**Frontend** (`fidel-bingo/frontend/.env`):
```env
VITE_APP_VERSION=2.0.1
```

**Backend** (`fidel-bingo/backend/.env`):
```env
APP_VERSION=2.0.1
```

### Version Check Interval:
Located in `App.tsx`:
```typescript
const interval = setInterval(() => {
  checkVersion();
}, 30_000); // 30 seconds - adjust as needed
```

## Security Notes

- Version endpoint is public (no auth required)
- Only returns version string, no sensitive data
- Cache headers set to `no-store` to prevent stale version info
- Service worker and all caches are cleared on update to prevent old code execution

## Troubleshooting

### Update Screen Doesn't Appear:
- Check backend `/api/version` endpoint is accessible
- Verify versions don't match: `CLIENT_VERSION !== server version`
- Check browser console for version check logs

### Update Fails:
- Check service worker registration status
- Verify cache API is available
- Check browser console for errors
- Try hard refresh (Ctrl+Shift+R)

### Users Stuck on Old Version:
- Verify backend deployed with new version first
- Check frontend build includes updated version number
- Ensure CDN/cache is cleared if using one
