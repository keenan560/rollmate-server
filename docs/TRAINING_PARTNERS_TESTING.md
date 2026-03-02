# Training Partners Testing Guide

## Quick Start

### 1. Run Database Migration

Execute in your Supabase SQL editor:

```sql
-- Run the migration
\i migrations/add_training_partners_fields.sql
```

Or copy/paste the contents of `migrations/add_training_partners_fields.sql`.

### 2. Add Test Data

Insert some test users with location data:

```sql
-- Update your user with location
UPDATE users 
SET 
  latitude = 40.7128,  -- New York City
  longitude = -74.0060,
  primary_gym = 'gym-123',
  available_now = false,
  is_online = true,
  weight = 180
WHERE id = 'YOUR_USER_ID';

-- Add test user 1 (Available Now, Same Gym, Nearby)
INSERT INTO users (id, first_name, last_name, belt, latitude, longitude, primary_gym, available_now, is_online, weight)
VALUES 
  ('test-user-1', 'John', 'Doe', 'blue', 40.7580, -73.9855, 'gym-123', true, true, 175)
ON CONFLICT (id) DO UPDATE SET
  latitude = 40.7580,
  longitude = -73.9855,
  primary_gym = 'gym-123',
  available_now = true,
  is_online = true;

-- Add test user 2 (Same Gym, Nearby)
INSERT INTO users (id, first_name, last_name, belt, latitude, longitude, primary_gym, available_now, is_online, weight)
VALUES 
  ('test-user-2', 'Jane', 'Smith', 'purple', 40.7489, -73.9680, 'gym-123', false, false, 145)
ON CONFLICT (id) DO UPDATE SET
  latitude = 40.7489,
  longitude = -73.9680,
  primary_gym = 'gym-123',
  available_now = false;

-- Add test user 3 (Nearby, Different Gym)
INSERT INTO users (id, first_name, last_name, belt, latitude, longitude, primary_gym, available_now, is_online, weight)
VALUES 
  ('test-user-3', 'Mike', 'Johnson', 'brown', 40.6782, -73.9442, 'gym-456', false, true, 195)
ON CONFLICT (id) DO UPDATE SET
  latitude = 40.6782,
  longitude = -73.9442,
  primary_gym = 'gym-456',
  available_now = false;

-- Add test user 4 (Far Away - should not appear in nearby)
INSERT INTO users (id, first_name, last_name, belt, latitude, longitude, primary_gym, available_now, is_online, weight)
VALUES 
  ('test-user-4', 'Sarah', 'Williams', 'black', 34.0522, -118.2437, 'gym-789', false, false, 130)
ON CONFLICT (id) DO UPDATE SET
  latitude = 34.0522,
  longitude = -118.2437,
  primary_gym = 'gym-789',
  available_now = false;
```

### 3. Test the Endpoint

#### Test GET Training Partners (using curl):
```bash
# Get your Firebase token first
# Then test the endpoint
curl -X GET http://localhost:3000/training-partners \
  -H "Authorization: Bearer YOUR_FIREBASE_TOKEN" \
  | jq '.'
```

#### Test POST Available Now (using curl):
```bash
# Set yourself as available
curl -X POST http://localhost:3000/users/available-now \
  -H "Authorization: Bearer YOUR_FIREBASE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"available_now": true}'

# Set yourself as unavailable
curl -X POST http://localhost:3000/users/available-now \
  -H "Authorization: Bearer YOUR_FIREBASE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"available_now": false}'
```

#### Using JavaScript/React Native:
```javascript
// Test GET training partners
const testTrainingPartners = async () => {
  const idToken = await auth().currentUser?.getIdToken();
  const response = await fetch('http://localhost:3000/training-partners', {
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });
  const data = await response.json();
  console.log('Training Partners:', data);
};

// Test POST available now
const testToggleAvailability = async (isAvailable) => {
  const idToken = await auth().currentUser?.getIdToken();
  const response = await fetch('http://localhost:3000/users/available-now', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ available_now: isAvailable }),
  });
  const data = await response.json();
  console.log('Toggle Result:', data);
};
```

## Expected Results

Based on the test data above, you should see:

### Available Now
- John Doe (test-user-1) - ~3.5 miles away

### My Gym (gym-123)
- John Doe (test-user-1) - ~3.5 miles away
- Jane Smith (test-user-2) - ~2.8 miles away

### Nearby (within 50 miles)
- Jane Smith (test-user-2) - ~2.8 miles away
- John Doe (test-user-1) - ~3.5 miles away
- Mike Johnson (test-user-3) - ~4.2 miles away

### Not Included
- Sarah Williams (test-user-4) - ~2,450 miles away (Los Angeles)

## Test Cases

### Test Case 1: User with Location
**Setup:** User has valid latitude/longitude
**Expected:** Returns categorized users
**Verify:** All three categories populated correctly

### Test Case 2: Available Now Filter
**Setup:** Set test-user-1 available_now = true
**Expected:** test-user-1 appears in availableNow category
**Verify:** Only users with available_now=true in this category

### Test Case 3: Same Gym Filter
**Setup:** Multiple users with same primary_gym
**Expected:** All users from same gym appear in gymMembers
**Verify:** Users from different gyms not included

### Test Case 4: Distance Filter
**Setup:** Users at various distances
**Expected:** Only users within 50 miles in nearby category
**Verify:** Far away users excluded

### Test Case 5: Distance Sorting
**Setup:** Multiple users at different distances
**Expected:** Users sorted by distance (closest first)
**Verify:** Check distance values are ascending

### Test Case 6: User Without Location
**Setup:** User has null latitude/longitude
**Expected:** 404 error or empty results
**Verify:** Proper error handling

### Test Case 7: No Other Users
**Setup:** Only current user in database
**Expected:** Empty arrays for all categories
**Verify:** No errors, just empty results

### Test Case 8: Overlapping Categories
**Setup:** User is available, same gym, and nearby
**Expected:** User appears in all three categories
**Verify:** Same user can be in multiple categories

### Test Case 9: Toggle Availability
**Setup:** User toggles available_now status
**Expected:** Status updates successfully
**Verify:** Returns success message and updated status

### Test Case 10: Invalid Toggle Value
**Setup:** Send non-boolean value for available_now
**Expected:** 400 error with validation message
**Verify:** Proper error handling

### Test Case 11: Availability Persistence
**Setup:** Toggle availability, then fetch training partners
**Expected:** User's new status reflected in results
**Verify:** Database update persists

## Distance Verification

Calculate expected distances using online tools:
- [Distance Calculator](https://www.nhc.noaa.gov/gccalc.shtml)
- [Lat/Long Distance Tool](https://www.movable-type.co.uk/scripts/latlong.html)

Example coordinates from test data:
- Your location: 40.7128, -74.0060 (NYC)
- Test User 1: 40.7580, -73.9855 (Times Square)
- Expected distance: ~3.5 miles

## Troubleshooting

### Empty Results
```sql
-- Check if users have location data
SELECT id, first_name, last_name, latitude, longitude, primary_gym, available_now
FROM users
WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
```

### Incorrect Distances
```sql
-- Verify coordinate format
SELECT id, first_name, 
       latitude, longitude,
       CASE 
         WHEN latitude < -90 OR latitude > 90 THEN 'Invalid latitude'
         WHEN longitude < -180 OR longitude > 180 THEN 'Invalid longitude'
         ELSE 'Valid'
       END as validation
FROM users
WHERE latitude IS NOT NULL;
```

### Users Not Appearing in Categories
```sql
-- Check user flags
SELECT id, first_name, available_now, primary_gym, latitude, longitude
FROM users
WHERE id = 'test-user-1';
```

## Performance Testing

### Test with Large Dataset
```sql
-- Generate 1000 test users with random locations
INSERT INTO users (id, first_name, last_name, belt, latitude, longitude, primary_gym, available_now, weight)
SELECT 
  'perf-test-' || generate_series,
  'User',
  'Test' || generate_series,
  (ARRAY['white', 'blue', 'purple', 'brown', 'black'])[floor(random() * 5 + 1)],
  40.7128 + (random() - 0.5) * 2,  -- Random lat near NYC
  -74.0060 + (random() - 0.5) * 2, -- Random lng near NYC
  'gym-' || floor(random() * 10 + 1),
  random() > 0.8,  -- 20% available
  150 + random() * 100  -- Random weight 150-250
FROM generate_series(1, 1000);
```

### Measure Response Time
```bash
# Test response time
time curl -X GET http://localhost:3000/training-partners \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -o /dev/null -s
```

Expected response time:
- < 100ms for small datasets (< 100 users)
- < 500ms for medium datasets (100-1000 users)
- < 2s for large datasets (1000-10000 users)

## Cleanup Test Data

```sql
-- Remove test users
DELETE FROM users WHERE id LIKE 'test-user-%';
DELETE FROM users WHERE id LIKE 'perf-test-%';
```

## Integration Testing

### Test with Frontend
1. Open your React Native app
2. Navigate to Training Partners screen
3. Verify three sections appear
4. Check that distances are displayed
5. Verify sorting (closest first)
6. Test pull-to-refresh
7. Test user profile navigation

### Test Availability Toggle
1. Toggle your "Available Now" status
2. Refresh training partners
3. Verify you don't appear in your own results
4. Have another user toggle availability
5. Verify they appear/disappear from Available Now

## Success Criteria

✅ GET /training-partners returns 200 status
✅ Response has three arrays: availableNow, gymMembers, nearby
✅ Users are correctly categorized
✅ Distances are calculated accurately
✅ Results are sorted by distance
✅ Current user is excluded from results
✅ Users without location are excluded
✅ Response time is acceptable (< 2s)
✅ POST /users/available-now returns 200 status
✅ Availability toggle updates database
✅ Invalid toggle values return 400 error
✅ Availability changes reflected in training partners results

## Next Steps

After testing:
1. Monitor server logs for errors
2. Check database query performance
3. Consider adding caching if needed
4. Implement real-time updates (optional)
5. Add user feedback/rating system (optional)
