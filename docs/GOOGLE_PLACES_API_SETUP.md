# Google Places API Setup Guide

## Overview
Backend proxy endpoints for Google Places API to search for BJJ gyms and retrieve gym details. This keeps your API key secure and avoids CORS issues in mobile apps.

## Prerequisites

1. **Google Cloud Project**
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project or select existing one

2. **Enable Places API**
   - Navigate to "APIs & Services" > "Library"
   - Search for "Places API"
   - Click "Enable"

3. **Create API Key**
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "API Key"
   - Copy the API key

4. **Restrict API Key (Recommended)**
   - Click on your API key to edit
   - Under "API restrictions", select "Restrict key"
   - Choose "Places API" from the dropdown
   - Under "Application restrictions", select "IP addresses"
   - Add your server's IP address
   - Save changes

## Environment Setup

Add to your `.env` file:
```bash
GOOGLE_PLACES_API_KEY=your_google_places_api_key_here
```

## API Endpoints

### 1. Search Nearby Gyms
```
GET /places/nearby-gyms
```

**Query Parameters:**
- `lat` (required) - Latitude
- `lng` (required) - Longitude  
- `radius` (optional) - Search radius in meters (default: 24140 = 15 miles)

**Example Request:**
```bash
curl "http://localhost:3001/places/nearby-gyms?lat=35.7914&lng=-86.5045&radius=24140" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Example Response:**
```json
{
  "results": [
    {
      "place_id": "ChIJN1t_tDeuEmsRUsoyG83frY4",
      "name": "Gracie Barra Nashville",
      "vicinity": "123 Main St, Nashville, TN",
      "geometry": {
        "location": {
          "lat": 35.7915,
          "lng": -86.5046
        }
      },
      "rating": 4.8,
      "user_ratings_total": 156,
      "photos": [
        {
          "photo_reference": "CmRaAAAA...",
          "height": 1080,
          "width": 1920
        }
      ]
    }
  ],
  "status": "OK",
  "next_page_token": "CpQB..."
}
```

### 2. Get Gym Details
```
GET /places/gym-details/:place_id
```

**Example Request:**
```bash
curl "http://localhost:3001/places/gym-details/ChIJN1t_tDeuEmsRUsoyG83frY4" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Example Response:**
```json
{
  "result": {
    "name": "Gracie Barra Nashville",
    "formatted_address": "123 Main St, Nashville, TN 37201",
    "formatted_phone_number": "(615) 555-1234",
    "website": "https://graciebarranashville.com",
    "opening_hours": {
      "open_now": true,
      "weekday_text": [
        "Monday: 6:00 AM – 9:00 PM",
        "Tuesday: 6:00 AM – 9:00 PM",
        "..."
      ]
    },
    "rating": 4.8,
    "user_ratings_total": 156,
    "geometry": {
      "location": {
        "lat": 35.7915,
        "lng": -86.5046
      }
    },
    "url": "https://maps.google.com/?cid=..."
  },
  "status": "OK"
}
```

### 3. Get Photo URL
```
GET /places/photo/:photo_reference
```

**Query Parameters:**
- `maxwidth` (optional) - Maximum width in pixels (default: 400)

**Example Request:**
```bash
curl "http://localhost:3001/places/photo/CmRaAAAA...?maxwidth=800" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Example Response:**
```json
{
  "photo_url": "https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=CmRaAAAA...&key=YOUR_KEY"
}
```

## Frontend Integration

### Search Nearby Gyms
```typescript
const searchNearbyGyms = async (latitude: number, longitude: number, radiusMiles: number = 15) => {
  const radiusMeters = radiusMiles * 1609.34; // Convert miles to meters
  
  const response = await fetch(
    `${API_BASE_URL}/places/nearby-gyms?lat=${latitude}&lng=${longitude}&radius=${radiusMeters}`,
    {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    }
  );
  
  const data = await response.json();
  return data.results;
};
```

### Get Gym Details
```typescript
const getGymDetails = async (placeId: string) => {
  const response = await fetch(
    `${API_BASE_URL}/places/gym-details/${placeId}`,
    {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    }
  );
  
  const data = await response.json();
  return data.result;
};
```

### Get Photo URL
```typescript
const getPhotoUrl = async (photoReference: string, maxWidth: number = 400) => {
  const response = await fetch(
    `${API_BASE_URL}/places/photo/${photoReference}?maxwidth=${maxWidth}`,
    {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    }
  );
  
  const data = await response.json();
  return data.photo_url;
};
```

## Cost Considerations

Google Places API pricing (as of 2024):
- **Nearby Search**: $32 per 1,000 requests
- **Place Details**: $17 per 1,000 requests
- **Place Photos**: $7 per 1,000 requests

### Cost Optimization Tips

1. **Cache Results**
   - Cache gym search results for 24 hours
   - Store frequently accessed gym details in your database

2. **Limit Requests**
   - Only fetch details when user taps on a gym
   - Lazy load photos as user scrolls

3. **Set Billing Alerts**
   - Go to Google Cloud Console > Billing > Budgets & alerts
   - Set up alerts at $10, $50, $100 thresholds

4. **Use Free Tier**
   - Google provides $200 monthly credit
   - Approximately 6,250 nearby searches per month free

## Security Best Practices

1. **Never expose API key in frontend code**
2. **Use environment variables** for API key storage
3. **Add rate limiting** to prevent abuse:
   ```javascript
   const rateLimit = require('express-rate-limit');
   
   const placesLimiter = rateLimit({
     windowMs: 15 * 60 * 1000, // 15 minutes
     max: 100 // limit each IP to 100 requests per windowMs
   });
   
   router.use('/places', placesLimiter);
   ```
4. **Require authentication** on all endpoints (already implemented with `verifyToken`)
5. **Restrict API key** to your server's IP address in Google Cloud Console

## Testing

### Test Nearby Search
```bash
# Replace with your actual coordinates
curl "http://localhost:3001/places/nearby-gyms?lat=35.7914&lng=-86.5045&radius=24140" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Test with Different Radius
```bash
# 5 miles = 8046 meters
curl "http://localhost:3001/places/nearby-gyms?lat=35.7914&lng=-86.5045&radius=8046" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## Troubleshooting

### "Google Places API is not configured"
- Ensure `GOOGLE_PLACES_API_KEY` is set in your `.env` file
- Restart your server after adding the environment variable

### "REQUEST_DENIED" status
- Check that Places API is enabled in Google Cloud Console
- Verify API key is correct
- Check API key restrictions (IP addresses, API restrictions)

### No results returned
- Verify coordinates are correct (lat/lng not swapped)
- Try increasing the search radius
- Check that there are actually BJJ gyms in the area

### Rate limit errors
- Implement caching to reduce API calls
- Add rate limiting to your endpoints
- Consider upgrading your Google Cloud billing plan

## Monitoring

Monitor your API usage:
1. Go to Google Cloud Console
2. Navigate to "APIs & Services" > "Dashboard"
3. Click on "Places API"
4. View usage metrics and quotas

Set up alerts for unusual activity or approaching quota limits.
