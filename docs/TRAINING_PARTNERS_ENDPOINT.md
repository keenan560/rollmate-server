# Training Partners Endpoint

## Overview
The Training Partners endpoint returns users categorized by availability, gym membership, and proximity. It helps users find training partners based on different criteria.

## Endpoints

### GET /training-partners
Returns users in three categories: Available Now, My Gym, and Nearby

**Authentication:** Required (Firebase token)

**Headers:**
```
Authorization: Bearer <firebase-token>
```

**Response:**
```json
{
  "availableNow": [
    {
      "id": "user-id",
      "first_name": "John",
      "last_name": "Doe",
      "avatar_url": "https://...",
      "belt": "blue",
      "primary_gym": "gym-id",
      "weight": 180,
      "distance": 5.2,
      "available_now": true,
      "is_online": true
    }
  ],
  "gymMembers": [
    {
      "id": "user-id",
      "first_name": "Jane",
      "last_name": "Smith",
      "avatar_url": "https://...",
      "belt": "purple",
      "primary_gym": "gym-id",
      "weight": 145,
      "distance": 3.8,
      "available_now": false,
      "is_online": false
    }
  ],
  "nearby": [
    {
      "id": "user-id",
      "first_name": "Mike",
      "last_name": "Johnson",
      "avatar_url": "https://...",
      "belt": "brown",
      "primary_gym": "other-gym-id",
      "weight": 195,
      "distance": 12.5,
      "available_now": false,
      "is_online": true
    }
  ]
}
```

---

### POST /users/available-now
Toggle user's availability status

**Authentication:** Required (Firebase token)

**Headers:**
```
Authorization: Bearer <firebase-token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "available_now": true
}
```

**Response:**
```json
{
  "success": true,
  "available_now": true,
  "message": "You are now showing as available"
}
```

**Validation:**
- `available_now` must be a boolean value
- Returns 400 if not a boolean

**Use Cases:**
- User toggles "Available Now" switch in app
- User wants to signal they're ready to train
- User wants to remove availability status

---

## Categories

### Available Now
Users who have toggled their "available_now" status to true, indicating they're ready to train right now.

**Criteria:**
- `available_now = true`
- Sorted by distance (closest first)

### My Gym
Users who train at the same primary gym as the current user.

**Criteria:**
- `primary_gym` matches current user's `primary_gym`
- Sorted by distance (closest first)

### Nearby
Users within 50 miles of the current user's location.

**Criteria:**
- Distance ≤ 50 miles
- Sorted by distance (closest first)

## Distance Calculation

The endpoint uses the Haversine formula to calculate the great-circle distance between two points on Earth.

**Formula:**
```javascript
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 3959; // Earth's radius in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in miles
}
```

**Note:** Distance is returned in miles. To convert to kilometers, multiply by 1.60934.

## Requirements

### Database Schema

The `users` table must have the following columns:

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  first_name TEXT,
  last_name TEXT,
  avatar_url TEXT,
  belt TEXT,
  primary_gym TEXT,
  weight NUMERIC,
  latitude NUMERIC,
  longitude NUMERIC,
  available_now BOOLEAN DEFAULT false,
  is_online BOOLEAN DEFAULT false
);
```

### Required Fields
- `latitude` and `longitude` - User's location coordinates
- `primary_gym` - User's primary gym identifier
- `available_now` - Boolean flag for availability
- `is_online` - Boolean flag for online status

### Indexes (Recommended)
```sql
CREATE INDEX idx_users_available_now ON users(available_now);
CREATE INDEX idx_users_primary_gym ON users(primary_gym);
CREATE INDEX idx_users_location ON users(latitude, longitude);
```

## Implementation Details

### Filtering
- Excludes the current user from results
- Only includes users with valid latitude/longitude coordinates
- Users can appear in multiple categories

### Sorting
All three categories are sorted by distance (closest first):
- Users without distance data are sorted to the end (Infinity)
- Distance is calculated from current user's location

### Performance Considerations
- Fetches all users in a single query
- Distance calculation is done in-memory (JavaScript)
- For large user bases, consider:
  - Database-level distance filtering (PostGIS)
  - Caching frequently accessed data
  - Pagination for large result sets

## Frontend Integration

### Fetch Training Partners
```javascript
import auth from '@react-native-firebase/auth';
import { getBaseUrl } from './config';

const fetchTrainingPartners = async () => {
  try {
    const idToken = await auth().currentUser?.getIdToken();
    const response = await fetch(`${getBaseUrl()}/training-partners`, {
      headers: {
        Authorization: `Bearer ${idToken}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch training partners');
    }

    const data = await response.json();
    return data; // { availableNow, gymMembers, nearby }
  } catch (error) {
    console.error('Error fetching training partners:', error);
    throw error;
  }
};
```

### Toggle Available Now Status
```javascript
const toggleAvailableNow = async (isAvailable) => {
  try {
    const idToken = await auth().currentUser?.getIdToken();
    const response = await fetch(`${getBaseUrl()}/users/available-now`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ available_now: isAvailable }),
    });

    if (!response.ok) {
      throw new Error('Failed to update availability');
    }

    const data = await response.json();
    return data; // { success, available_now, message }
  } catch (error) {
    console.error('Error updating availability:', error);
    throw error;
  }
};
```

### Display Training Partners with Toggle
```javascript
const TrainingPartnersScreen = () => {
  const [partners, setPartners] = useState({
    availableNow: [],
    gymMembers: [],
    nearby: [],
  });
  const [isAvailable, setIsAvailable] = useState(false);

  useEffect(() => {
    const loadPartners = async () => {
      const data = await fetchTrainingPartners();
      setPartners(data);
    };
    loadPartners();
  }, []);

  const handleToggleAvailability = async (value) => {
    try {
      const result = await toggleAvailableNow(value);
      setIsAvailable(result.available_now);
      // Show success message
      Alert.alert('Success', result.message);
      // Refresh partners list
      const data = await fetchTrainingPartners();
      setPartners(data);
    } catch (error) {
      Alert.alert('Error', 'Failed to update availability');
    }
  };

  return (
    <ScrollView>
      <View style={styles.toggleContainer}>
        <Text>Available Now</Text>
        <Switch
          value={isAvailable}
          onValueChange={handleToggleAvailability}
        />
      </View>

      <Section title="Available Now">
        {partners.availableNow.map(user => (
          <UserCard key={user.id} user={user} />
        ))}
      </Section>

      <Section title="My Gym">
        {partners.gymMembers.map(user => (
          <UserCard key={user.id} user={user} />
        ))}
      </Section>

      <Section title="Nearby">
        {partners.nearby.map(user => (
          <UserCard key={user.id} user={user} />
        ))}
      </Section>
    </ScrollView>
  );
};
```

### Display Training Partners
```javascript
const TrainingPartnersScreen = () => {
  const [partners, setPartners] = useState({
    availableNow: [],
    gymMembers: [],
    nearby: [],
  });

  useEffect(() => {
    const loadPartners = async () => {
      const data = await fetchTrainingPartners();
      setPartners(data);
    };
    loadPartners();
  }, []);

  return (
    <ScrollView>
      <Section title="Available Now">
        {partners.availableNow.map(user => (
          <UserCard key={user.id} user={user} />
        ))}
      </Section>

      <Section title="My Gym">
        {partners.gymMembers.map(user => (
          <UserCard key={user.id} user={user} />
        ))}
      </Section>

      <Section title="Nearby">
        {partners.nearby.map(user => (
          <UserCard key={user.id} user={user} />
        ))}
      </Section>
    </ScrollView>
  );
};
```

## Testing

### Test GET Training Partners
```bash
curl -X GET http://localhost:3000/training-partners \
  -H "Authorization: Bearer YOUR_FIREBASE_TOKEN"
```

### Test POST Available Now (Set to Available)
```bash
curl -X POST http://localhost:3000/users/available-now \
  -H "Authorization: Bearer YOUR_FIREBASE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"available_now": true}'
```

### Test POST Available Now (Set to Unavailable)
```bash
curl -X POST http://localhost:3000/users/available-now \
  -H "Authorization: Bearer YOUR_FIREBASE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"available_now": false}'
```

### Expected Response Structure
```json
{
  "availableNow": [],
  "gymMembers": [],
  "nearby": []
}
```

### Test Cases
1. **User with no location** - Should return 404 or empty results
2. **User with location** - Should return categorized users
3. **User with gym** - Should return gym members
4. **Available users** - Should appear in availableNow category
5. **Distance sorting** - Closest users should appear first
6. **Toggle availability** - Should update available_now status
7. **Invalid toggle value** - Should return 400 error
8. **Refresh after toggle** - Should see updated availability in results

## Troubleshooting

### Empty Results
**Possible causes:**
- Current user has no latitude/longitude set
- No other users have location data
- No users match the criteria (available, same gym, nearby)

**Solution:**
- Ensure users have location data in the database
- Check that `available_now` is set for some users
- Verify `primary_gym` values match

### Incorrect Distances
**Possible causes:**
- Latitude/longitude values are incorrect
- Coordinates are in wrong format (should be decimal degrees)

**Solution:**
- Verify coordinate format: latitude (-90 to 90), longitude (-180 to 180)
- Check that coordinates are stored as NUMERIC, not TEXT

### Performance Issues
**Possible causes:**
- Large number of users
- No database indexes
- Distance calculation for all users

**Solutions:**
- Add indexes on `latitude`, `longitude`, `available_now`, `primary_gym`
- Consider using PostGIS for database-level distance filtering
- Implement pagination
- Cache results with short TTL

### Users Appearing in Wrong Categories
**Possible causes:**
- `available_now` or `primary_gym` values are incorrect
- Distance calculation error

**Solution:**
- Verify user data in database
- Test distance calculation with known coordinates
- Check that 50-mile radius is appropriate for your use case

## Customization Options

### Adjust Distance Radius
Change the nearby distance threshold (default: 50 miles):

```javascript
// In trainingPartners.routes.js
if (distance !== null && distance <= 100) { // Changed to 100 miles
  nearby.push(userWithDistance);
}
```

### Add Additional Filters
Filter by belt, weight class, or other criteria:

```javascript
// Filter by belt level
if (user.belt === 'blue' || user.belt === 'purple') {
  // Add to category
}

// Filter by weight class
const weightDiff = Math.abs(user.weight - currentUserWeight);
if (weightDiff <= 20) { // Within 20 lbs
  // Add to category
}
```

### Add Pagination
For large result sets:

```javascript
router.get("/training-partners", verifyToken, async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 50;
  
  // Apply pagination to each category
  const availableNow = allAvailable.slice((page - 1) * limit, page * limit);
  // ... etc
});
```

## Security Considerations

1. **Location Privacy**
   - Consider rounding coordinates to reduce precision
   - Allow users to opt-out of location sharing
   - Don't expose exact addresses

2. **Rate Limiting**
   - Implement rate limiting to prevent abuse
   - Cache results to reduce database load

3. **Data Validation**
   - Validate latitude/longitude ranges
   - Sanitize user input
   - Handle missing/null values gracefully

## Future Enhancements

1. **Real-time Updates**
   - Use WebSockets for live availability updates
   - Push notifications when nearby users become available

2. **Advanced Filtering**
   - Filter by skill level, weight class, age
   - Search by name or gym
   - Favorite/blocked users

3. **Geospatial Optimization**
   - Use PostGIS for database-level distance queries
   - Implement spatial indexes
   - Add geofencing for notifications

4. **Social Features**
   - Send training requests
   - Schedule training sessions
   - Rate training partners

## Summary

✅ Endpoints created:
  - `GET /training-partners` - Fetch categorized training partners
  - `POST /users/available-now` - Toggle availability status
✅ Three categories: Available Now, My Gym, Nearby
✅ Distance calculation using Haversine formula
✅ Sorted by proximity (closest first)
✅ Integrated with existing authentication
✅ Comprehensive error handling
✅ Real-time availability toggling
