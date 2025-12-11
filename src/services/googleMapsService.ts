/**
 * Google Maps Distance Service
 * Calculates route distances between origin and destination using Google Maps API
 */

import axios from 'axios';

// Types
export interface GeoLocation {
  lat: number;
  lng: number;
  formattedAddress?: string;
}

export interface RouteDistance {
  distanceMiles: number;
  distanceKm: number;
  durationMinutes: number;
  durationText: string;
  distanceText: string;
  origin: GeoLocation;
  destination: GeoLocation;
}

export interface LocationInput {
  city?: string | null;
  state?: string | null;
  country?: string | null;
  region?: string | null;
  fullAddress?: string | null;
  postalCode?: string | null;
}

// City coordinates cache for common shipping locations
// This reduces API calls for frequently used locations
const CITY_COORDINATES_CACHE: Record<string, GeoLocation> = {
  // US West Coast
  'los angeles, ca, usa': { lat: 34.0522, lng: -118.2437 },
  'long beach, ca, usa': { lat: 33.7701, lng: -118.1937 },
  'oakland, ca, usa': { lat: 37.8044, lng: -122.2712 },
  'san francisco, ca, usa': { lat: 37.7749, lng: -122.4194 },
  'seattle, wa, usa': { lat: 47.6062, lng: -122.3321 },
  'tacoma, wa, usa': { lat: 47.2529, lng: -122.4443 },
  'portland, or, usa': { lat: 45.5152, lng: -122.6784 },
  'san diego, ca, usa': { lat: 32.7157, lng: -117.1611 },

  // US Gulf Coast
  'houston, tx, usa': { lat: 29.7604, lng: -95.3698 },
  'new orleans, la, usa': { lat: 29.9511, lng: -90.0715 },
  'galveston, tx, usa': { lat: 29.3013, lng: -94.7977 },
  'mobile, al, usa': { lat: 30.6954, lng: -88.0399 },

  // US East Coast
  'new york, ny, usa': { lat: 40.7128, lng: -74.0060 },
  'newark, nj, usa': { lat: 40.7357, lng: -74.1724 },
  'elizabeth, nj, usa': { lat: 40.6640, lng: -74.2107 },
  'savannah, ga, usa': { lat: 32.0809, lng: -81.0912 },
  'charleston, sc, usa': { lat: 32.7765, lng: -79.9311 },
  'norfolk, va, usa': { lat: 36.8508, lng: -76.2859 },
  'baltimore, md, usa': { lat: 39.2904, lng: -76.6122 },
  'philadelphia, pa, usa': { lat: 39.9526, lng: -75.1652 },
  'boston, ma, usa': { lat: 42.3601, lng: -71.0589 },
  'miami, fl, usa': { lat: 25.7617, lng: -80.1918 },
  'jacksonville, fl, usa': { lat: 30.3322, lng: -81.6557 },
  'tampa, fl, usa': { lat: 27.9506, lng: -82.4572 },

  // US Midwest
  'chicago, il, usa': { lat: 41.8781, lng: -87.6298 },
  'detroit, mi, usa': { lat: 42.3314, lng: -83.0458 },
  'cleveland, oh, usa': { lat: 41.4993, lng: -81.6944 },
  'columbus, oh, usa': { lat: 39.9612, lng: -82.9988 },
  'indianapolis, in, usa': { lat: 39.7684, lng: -86.1581 },
  'milwaukee, wi, usa': { lat: 43.0389, lng: -87.9065 },
  'minneapolis, mn, usa': { lat: 44.9778, lng: -93.2650 },
  'st. louis, mo, usa': { lat: 38.6270, lng: -90.1994 },
  'kansas city, mo, usa': { lat: 39.0997, lng: -94.5786 },
  'waukesha, wi, usa': { lat: 43.0117, lng: -88.2315 },

  // US Central/South
  'dallas, tx, usa': { lat: 32.7767, lng: -96.7970 },
  'atlanta, ga, usa': { lat: 33.7490, lng: -84.3880 },
  'denver, co, usa': { lat: 39.7392, lng: -104.9903 },
  'memphis, tn, usa': { lat: 35.1495, lng: -90.0490 },
  'nashville, tn, usa': { lat: 36.1627, lng: -86.7816 },
  'orlando, fl, usa': { lat: 28.5383, lng: -81.3792 },

  // International - Asia
  'shanghai, china': { lat: 31.2304, lng: 121.4737 },
  'shenzhen, china': { lat: 22.5431, lng: 114.0579 },
  'ningbo, china': { lat: 29.8683, lng: 121.5440 },
  'hong kong, china': { lat: 22.3193, lng: 114.1694 },
  'busan, south korea': { lat: 35.1796, lng: 129.0756 },
  'singapore, singapore': { lat: 1.3521, lng: 103.8198 },
  'tokyo, japan': { lat: 35.6762, lng: 139.6503 },
  'yokohama, japan': { lat: 35.4437, lng: 139.6380 },

  // International - Europe
  'rotterdam, netherlands': { lat: 51.9244, lng: 4.4777 },
  'hamburg, germany': { lat: 53.5511, lng: 9.9937 },
  'antwerp, belgium': { lat: 51.2194, lng: 4.4025 },
  'felixstowe, uk': { lat: 51.9615, lng: 1.3509 },
  'le havre, france': { lat: 49.4944, lng: 0.1079 },
};

// State abbreviation to full name mapping
const STATE_ABBREVIATIONS: Record<string, string> = {
  'al': 'alabama', 'ak': 'alaska', 'az': 'arizona', 'ar': 'arkansas',
  'ca': 'california', 'co': 'colorado', 'ct': 'connecticut', 'de': 'delaware',
  'fl': 'florida', 'ga': 'georgia', 'hi': 'hawaii', 'id': 'idaho',
  'il': 'illinois', 'in': 'indiana', 'ia': 'iowa', 'ks': 'kansas',
  'ky': 'kentucky', 'la': 'louisiana', 'me': 'maine', 'md': 'maryland',
  'ma': 'massachusetts', 'mi': 'michigan', 'mn': 'minnesota', 'ms': 'mississippi',
  'mo': 'missouri', 'mt': 'montana', 'ne': 'nebraska', 'nv': 'nevada',
  'nh': 'new hampshire', 'nj': 'new jersey', 'nm': 'new mexico', 'ny': 'new york',
  'nc': 'north carolina', 'nd': 'north dakota', 'oh': 'ohio', 'ok': 'oklahoma',
  'or': 'oregon', 'pa': 'pennsylvania', 'ri': 'rhode island', 'sc': 'south carolina',
  'sd': 'south dakota', 'tn': 'tennessee', 'tx': 'texas', 'ut': 'utah',
  'vt': 'vermont', 'va': 'virginia', 'wa': 'washington', 'wv': 'west virginia',
  'wi': 'wisconsin', 'wy': 'wyoming', 'dc': 'district of columbia',
};

/**
 * Build a normalized cache key from location components
 */
function buildCacheKey(location: LocationInput): string {
  const parts: string[] = [];

  if (location.city) {
    parts.push(location.city.toLowerCase().trim());
  }

  if (location.state) {
    const stateNorm = location.state.toLowerCase().trim();
    // Convert full state name to abbreviation format for consistency
    parts.push(stateNorm.length === 2 ? stateNorm : stateNorm);
  }

  if (location.country) {
    const countryNorm = location.country.toLowerCase().trim();
    // Normalize common country variations
    if (countryNorm === 'united states' || countryNorm === 'us') {
      parts.push('usa');
    } else {
      parts.push(countryNorm);
    }
  } else if (location.state && STATE_ABBREVIATIONS[location.state.toLowerCase()]) {
    // If no country but valid US state, assume USA
    parts.push('usa');
  }

  return parts.join(', ');
}

/**
 * Try to find coordinates in the cache
 */
function getCachedCoordinates(location: LocationInput): GeoLocation | null {
  const cacheKey = buildCacheKey(location);

  // Direct match
  if (CITY_COORDINATES_CACHE[cacheKey]) {
    return CITY_COORDINATES_CACHE[cacheKey];
  }

  // Try variations
  const city = (location.city || '').toLowerCase().trim();
  const state = (location.state || '').toLowerCase().trim();

  // Try with state abbreviation
  if (state.length === 2) {
    const fullState = STATE_ABBREVIATIONS[state];
    if (fullState) {
      const altKey = `${city}, ${state}, usa`;
      if (CITY_COORDINATES_CACHE[altKey]) {
        return CITY_COORDINATES_CACHE[altKey];
      }
    }
  }

  return null;
}

/**
 * Geocode a location using Google Maps Geocoding API
 */
export async function geocodeLocation(location: LocationInput): Promise<GeoLocation | null> {
  // Check cache first
  const cached = getCachedCoordinates(location);
  if (cached) {
    const cacheKey = buildCacheKey(location);
    console.log(`[GoogleMaps] Cache HIT for geocoding: "${cacheKey}"`);
    return cached;
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    console.warn('[GoogleMaps] GOOGLE_MAPS_API_KEY not configured, using approximation');
    return approximateCoordinates(location);
  }

  // Build address string for geocoding
  const addressParts: string[] = [];

  if (location.fullAddress) {
    addressParts.push(location.fullAddress);
  } else {
    if (location.city) addressParts.push(location.city);
    if (location.state) addressParts.push(location.state);
    if (location.postalCode) addressParts.push(location.postalCode);
    if (location.country) addressParts.push(location.country);
  }

  if (addressParts.length === 0) {
    return null;
  }

  const address = addressParts.join(', ');

  try {
    console.log(`[GoogleMaps] Geocoding API CALL: "${address}"`);
    const startTime = Date.now();

    const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
      params: {
        address,
        key: apiKey,
      },
    });

    const duration = Date.now() - startTime;

    if (response.data.status === 'OK' && response.data.results.length > 0) {
      const result = response.data.results[0];
      console.log(`[GoogleMaps] Geocoding API SUCCESS (${duration}ms): "${address}" -> (${result.geometry.location.lat}, ${result.geometry.location.lng})`);
      return {
        lat: result.geometry.location.lat,
        lng: result.geometry.location.lng,
        formattedAddress: result.formatted_address,
      };
    }

    console.warn(`[GoogleMaps] Geocoding API FAILED (${duration}ms): "${address}" - Status: ${response.data.status}`);
    return approximateCoordinates(location);
  } catch (error) {
    console.error('[GoogleMaps] Geocoding API ERROR:', (error as Error).message);
    return approximateCoordinates(location);
  }
}

/**
 * Approximate coordinates based on known cities/regions when API is unavailable
 */
function approximateCoordinates(location: LocationInput): GeoLocation | null {
  const city = (location.city || '').toLowerCase().trim();
  const state = (location.state || '').toLowerCase().trim();

  // Try to find a matching cached city
  for (const [key, coords] of Object.entries(CITY_COORDINATES_CACHE)) {
    if (city && key.includes(city)) {
      return coords;
    }
  }

  // Regional approximations for US states
  const stateCoordinates: Record<string, GeoLocation> = {
    'ca': { lat: 36.7783, lng: -119.4179 },
    'tx': { lat: 31.9686, lng: -99.9018 },
    'fl': { lat: 27.6648, lng: -81.5158 },
    'ny': { lat: 40.7128, lng: -74.0060 },
    'il': { lat: 40.6331, lng: -89.3985 },
    'pa': { lat: 41.2033, lng: -77.1945 },
    'oh': { lat: 40.4173, lng: -82.9071 },
    'ga': { lat: 32.1656, lng: -82.9001 },
    'nc': { lat: 35.7596, lng: -79.0193 },
    'mi': { lat: 44.3148, lng: -85.6024 },
    'nj': { lat: 40.0583, lng: -74.4057 },
    'va': { lat: 37.4316, lng: -78.6569 },
    'wa': { lat: 47.7511, lng: -120.7401 },
    'az': { lat: 34.0489, lng: -111.0937 },
    'ma': { lat: 42.4072, lng: -71.3824 },
    'tn': { lat: 35.5175, lng: -86.5804 },
    'in': { lat: 40.2672, lng: -86.1349 },
    'mo': { lat: 37.9643, lng: -91.8318 },
    'md': { lat: 39.0458, lng: -76.6413 },
    'wi': { lat: 43.7844, lng: -88.7879 },
    'mn': { lat: 46.7296, lng: -94.6859 },
    'co': { lat: 39.5501, lng: -105.7821 },
    'al': { lat: 32.3182, lng: -86.9023 },
    'sc': { lat: 33.8361, lng: -81.1637 },
    'la': { lat: 30.9843, lng: -91.9623 },
    'ky': { lat: 37.8393, lng: -84.2700 },
    'or': { lat: 43.8041, lng: -120.5542 },
    'ok': { lat: 35.0078, lng: -97.0929 },
    'ct': { lat: 41.6032, lng: -73.0877 },
    'ia': { lat: 41.8780, lng: -93.0977 },
    'ms': { lat: 32.3547, lng: -89.3985 },
    'ar': { lat: 35.2010, lng: -91.8318 },
    'ks': { lat: 39.0119, lng: -98.4842 },
    'nv': { lat: 38.8026, lng: -116.4194 },
    'nm': { lat: 34.5199, lng: -105.8701 },
    'ne': { lat: 41.4925, lng: -99.9018 },
    'wv': { lat: 38.5976, lng: -80.4549 },
  };

  if (state && stateCoordinates[state]) {
    return stateCoordinates[state];
  }

  return null;
}

/**
 * Calculate driving distance between two locations using Google Maps Distance Matrix API
 */
export async function calculateRouteDistance(
  origin: LocationInput,
  destination: LocationInput
): Promise<RouteDistance | null> {
  const originStr = [origin.city, origin.state, origin.country].filter(Boolean).join(', ');
  const destStr = [destination.city, destination.state, destination.country].filter(Boolean).join(', ');
  console.log(`[GoogleMaps] Calculating route distance: "${originStr}" -> "${destStr}"`);

  // Get coordinates for both locations
  const [originCoords, destCoords] = await Promise.all([
    geocodeLocation(origin),
    geocodeLocation(destination),
  ]);

  if (!originCoords || !destCoords) {
    console.warn(`[GoogleMaps] Could not geocode locations - origin: ${!!originCoords}, dest: ${!!destCoords}`);
    // Fall back to straight-line distance calculation
    if (originCoords && destCoords) {
      return calculateStraightLineDistance(originCoords, destCoords);
    }
    return null;
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    console.warn('[GoogleMaps] GOOGLE_MAPS_API_KEY not configured, using straight-line distance');
    const result = calculateStraightLineDistance(originCoords, destCoords);
    console.log(`[GoogleMaps] Straight-line distance (estimated): ${result.distanceMiles} miles`);
    return result;
  }

  try {
    console.log(`[GoogleMaps] Distance Matrix API CALL: (${originCoords.lat}, ${originCoords.lng}) -> (${destCoords.lat}, ${destCoords.lng})`);
    const startTime = Date.now();

    const response = await axios.get('https://maps.googleapis.com/maps/api/distancematrix/json', {
      params: {
        origins: `${originCoords.lat},${originCoords.lng}`,
        destinations: `${destCoords.lat},${destCoords.lng}`,
        mode: 'driving',
        units: 'imperial',
        key: apiKey,
      },
    });

    const duration = Date.now() - startTime;

    if (response.data.status === 'OK' && response.data.rows.length > 0) {
      const element = response.data.rows[0].elements[0];

      if (element.status === 'OK') {
        const distanceMeters = element.distance.value;
        const durationSeconds = element.duration.value;
        const distanceMiles = Math.round(distanceMeters / 1609.344 * 10) / 10;

        console.log(`[GoogleMaps] Distance Matrix API SUCCESS (${duration}ms): ${distanceMiles} miles, ${element.duration.text}`);

        return {
          distanceMiles,
          distanceKm: Math.round(distanceMeters / 1000 * 10) / 10,
          durationMinutes: Math.round(durationSeconds / 60),
          durationText: element.duration.text,
          distanceText: element.distance.text,
          origin: originCoords,
          destination: destCoords,
        };
      } else {
        console.warn(`[GoogleMaps] Distance Matrix API FAILED (${duration}ms): Element status: ${element.status}`);
      }
    } else {
      console.warn(`[GoogleMaps] Distance Matrix API FAILED (${duration}ms): Response status: ${response.data.status}`);
    }

    console.log('[GoogleMaps] Falling back to straight-line distance');
    const result = calculateStraightLineDistance(originCoords, destCoords);
    console.log(`[GoogleMaps] Straight-line distance (estimated): ${result.distanceMiles} miles`);
    return result;
  } catch (error) {
    console.error('[GoogleMaps] Distance Matrix API ERROR:', (error as Error).message);
    const result = calculateStraightLineDistance(originCoords, destCoords);
    console.log(`[GoogleMaps] Straight-line distance (fallback): ${result.distanceMiles} miles`);
    return result;
  }
}

/**
 * Calculate straight-line (haversine) distance when driving distance is unavailable
 */
function calculateStraightLineDistance(origin: GeoLocation, destination: GeoLocation): RouteDistance {
  const R = 3959; // Earth's radius in miles

  const lat1 = origin.lat * Math.PI / 180;
  const lat2 = destination.lat * Math.PI / 180;
  const deltaLat = (destination.lat - origin.lat) * Math.PI / 180;
  const deltaLng = (destination.lng - origin.lng) * Math.PI / 180;

  const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
            Math.cos(lat1) * Math.cos(lat2) *
            Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const straightLineDistance = R * c;

  // Road distance is typically 1.2-1.4x straight-line distance
  const roadMultiplier = 1.3;
  const estimatedRoadDistance = straightLineDistance * roadMultiplier;

  // Estimate driving time at average 55 mph
  const estimatedMinutes = Math.round(estimatedRoadDistance / 55 * 60);

  return {
    distanceMiles: Math.round(estimatedRoadDistance * 10) / 10,
    distanceKm: Math.round(estimatedRoadDistance * 1.60934 * 10) / 10,
    durationMinutes: estimatedMinutes,
    durationText: formatDuration(estimatedMinutes),
    distanceText: `~${Math.round(estimatedRoadDistance)} mi (estimated)`,
    origin,
    destination,
  };
}

/**
 * Format duration in minutes to human-readable string
 */
function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} mins`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;

  if (remainingMins === 0) {
    return `${hours} hour${hours > 1 ? 's' : ''}`;
  }

  return `${hours} hour${hours > 1 ? 's' : ''} ${remainingMins} mins`;
}

/**
 * Calculate distance for a quote's origin and destination
 */
export async function calculateQuoteDistance(quote: {
  origin_city?: string | null;
  origin_state_province?: string | null;
  origin_country?: string | null;
  origin_full_address?: string | null;
  destination_city?: string | null;
  destination_state_province?: string | null;
  destination_country?: string | null;
  destination_full_address?: string | null;
}): Promise<RouteDistance | null> {
  const origin: LocationInput = {
    city: quote.origin_city,
    state: quote.origin_state_province,
    country: quote.origin_country,
    fullAddress: quote.origin_full_address,
  };

  const destination: LocationInput = {
    city: quote.destination_city,
    state: quote.destination_state_province,
    country: quote.destination_country,
    fullAddress: quote.destination_full_address,
  };

  return calculateRouteDistance(origin, destination);
}

export default {
  geocodeLocation,
  calculateRouteDistance,
  calculateQuoteDistance,
};
