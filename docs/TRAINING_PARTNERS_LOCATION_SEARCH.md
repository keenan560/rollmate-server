# Training Partners Location Search Feature

## Overview
Enhanced training partners discovery with location-based filtering. Users can search for training partners by city or zip code, with customizable radius.

## Database Changes

### New Fields (users table)
- `city` (TEXT) - User's city for location search
- `zip_code` (TEXT) - User's zip code for location search

### New Database Functions

#### `get_user_location(user_id TEXT)`
Returns user's location data extracted from PostGIS point.

**Returns:**
```json
{
  "latitude": 40.7128,
  "longitude": -74.0060,
  "primary_gym": "Gracie Barra NYC",
  "city": "New York",
  "zip_code": "10001"
}
```

#### `get_users_with_location(exclude_user_id TEXT)`
Returns all users with location data, excluding specified user.

**Returns:** Array of user objects with location fields

#### `search_locations(search_query TEXT, result_limit INT)`
Typeahead search for cities and zip codes with user counts.

**Returns:**
```json
[
  {
    "location_name": "New York",
    "location_type": "city",
    "user_count": 45
  },
  {
    "location_name": "10001",
    "location_type": "zip",
    "user_count": 12
  }
]
```

## API Endpoints

### GET /training-partners
Enhanced with location filtering.

**Query Parameters:**
- `city` (optional) - Filter by city name
- `zip_code` (optional) - Filter by zip code
- `radius` (optional, default: 50) - Search radius in miles

**Examples:**
```bash
# All training partners (existing behavior)
GET /training-partners

# Partners in specific city
GET /training-partners?city=Austin

# Partners in specific zip code
GET /training-partners?zip_code=78701

# Partners within 25 miles of user in Austin
GET /training-partners?city=Austin&radius=25
```

**Response:**
```json
{
  "availableNow": [
    {
      "id": "user123",
      "first_name": "John",
      "last_name": "Doe",
      "avatar_url": "https://...",
      "belt": "blue",
      "primary_gym": "Gracie Barra Austin",
      "weight": 185,
      "distance": 3.2,
      "available_now": true,
      "is_online": true,
      "city": "Austin",
      "zip_code": "78701"
    }
  ],
  "gymMembers": [...],
  "nearby": [...]
}
```

### GET /training-partners/search-locations
Typeahead search for cities and zip codes.

**Query Parameters:**
- `q` (required) - Search query (minimum 2 characters)

**Examples:**
```bash
# Search for cities/zips starting with "Aus"
GET /training-partners/search-locations?q=Aus

# Search for zip codes starting with "787"
GET /training-partners/search-locations?q=787
```

**Response:**
```json
[
  {
    "location_name": "Austin",
    "location_type": "city",
    "user_count": 45
  },
  {
    "location_name": "78701",
    "location_type": "zip",
    "user_count": 12
  },
  {
    "location_name": "78702",
    "location_type": "zip",
    "user_count": 8
  }
]
```

## Frontend Implementation Guide

### Component Structure
```
TrainingPartnerSearch/
├── LocationSearchBar.tsx      # Typeahead search input
├── FilterControls.tsx         # Radius slider, toggles
├── PartnersList.tsx          # Results list
└── PartnerCard.tsx           # Individual partner card
```

### Example Usage

#### Location Search with Typeahead
```typescript
const [searchQuery, setSearchQuery] = useState('');
const [locations, setLocations] = useState([]);

const searchLocations = async (query: string) => {
  if (query.length < 2) {
    setLocations([]);
    return;
  }
  
  const response = await fetch(
    `/training-partners/search-locations?q=${encodeURIComponent(query)}`
  );
  const data = await response.json();
  setLocations(data);
};

// Debounced search
useEffect(() => {
  const timer = setTimeout(() => searchLocations(searchQuery), 300);
  return () => clearTimeout(timer);
}, [searchQuery]);
```

#### Fetch Partners by Location
```typescript
const [selectedLocation, setSelectedLocation] = useState(null);
const [radius, setRadius] = useState(50);

const fetchPartners = async () => {
  const params = new URLSearchParams();
  
  if (selectedLocation?.location_type === 'city') {
    params.append('city', selectedLocation.location_name);
  } else if (selectedLocation?.location_type === 'zip') {
    params.append('zip_code', selectedLocation.location_name);
  }
  
  params.append('radius', radius.toString());
  
  const response = await fetch(`/training-partners?${params}`);
  const data = await response.json();
  
  // data.availableNow, data.gymMembers, data.nearby
};
```

## Migration Instructions

1. Run the migration:
```bash
psql -d your_database -f migrations/add_location_search_fields.sql
```

2. Update existing users with city/zip data (optional):
```sql
-- Example: Extract city from existing data or use geocoding service
UPDATE users 
SET city = 'Austin', zip_code = '78701'
WHERE id = 'user123';
```

3. Restart your backend server to pick up the new endpoints

## Testing

### Test Location Search
```bash
# Should return empty array (query too short)
curl "http://localhost:3000/training-partners/search-locations?q=A"

# Should return locations starting with "Aus"
curl "http://localhost:3000/training-partners/search-locations?q=Aus"
```

### Test Filtered Partners
```bash
# Get partners in Austin within 25 miles
curl "http://localhost:3000/training-partners?city=Austin&radius=25" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## Future Enhancements (Option B)

If you want to add gyms as first-class entities later:
- Create `gyms` table with locations
- Add `primary_gym_id` foreign key to users
- Add gym discovery endpoints
- Show gym details with member counts
- Enable gym check-ins and reviews

## Notes

- Location search is case-insensitive
- Results are sorted by user count (most popular first)
- Distance calculations use Haversine formula (accurate for Earth's curvature)
- Default radius is 50 miles, adjustable per request
- City/zip fields are optional - users without them still appear in non-filtered searches
