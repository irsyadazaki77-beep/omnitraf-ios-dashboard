/**
 * OmniTRAF Surabaya - Geospatial Coordinates Converter & GeoJSON Validator
 * Standar koordinat:
 * - GeoJSON format: [longitude, latitude]
 * - Leaflet format: [latitude, longitude] (atau L.LatLng)
 */

/**
 * Validasi apakah latitude berada dalam rentang valid [-90, 90]
 * @param {number} lat
 * @returns {boolean}
 */
export function isValidLatitude(lat) {
  return typeof lat === 'number' && !Number.isNaN(lat) && lat >= -90 && lat <= 90;
}

/**
 * Validasi apakah longitude berada dalam rentang valid [-180, 180]
 * @param {number} lng
 * @returns {boolean}
 */
export function isValidLongitude(lng) {
  return typeof lng === 'number' && !Number.isNaN(lng) && lng >= -180 && lng <= 180;
}

/**
 * Validasi pasangan koordinat [lng, lat] GeoJSON
 * @param {[number, number]} coord
 * @returns {boolean}
 */
export function isValidGeoJsonCoord(coord) {
  if (!Array.isArray(coord) || coord.length < 2) return false;
  const [lng, lat] = coord;
  return isValidLongitude(lng) && isValidLatitude(lat);
}

/**
 * Validasi pasangan koordinat [lat, lng] Leaflet
 * @param {[number, number]} coord
 * @returns {boolean}
 */
export function isValidLeafletCoord(coord) {
  if (!Array.isArray(coord) || coord.length < 2) return false;
  const [lat, lng] = coord;
  return isValidLatitude(lat) && isValidLongitude(lng);
}

/**
 * Konversi GeoJSON [lng, lat] -> Leaflet [lat, lng]
 * @param {[number, number]} geoJsonCoord
 * @returns {[number, number]}
 */
export function geoJsonToLeaflet(geoJsonCoord) {
  if (!Array.isArray(geoJsonCoord) || geoJsonCoord.length < 2) {
    throw new Error(`[CoordinateUtils] Invalid GeoJSON coordinate: ${JSON.stringify(geoJsonCoord)}`);
  }
  const [lng, lat] = geoJsonCoord;
  if (!isValidLongitude(lng) || !isValidLatitude(lat)) {
    throw new Error(`[CoordinateUtils] GeoJSON coordinates out of bounds: lng=${lng}, lat=${lat}`);
  }
  return [lat, lng];
}

/**
 * Konversi Leaflet [lat, lng] -> GeoJSON [lng, lat]
 * @param {[number, number]|{lat: number, lng: number}} leafletCoord
 * @returns {[number, number]}
 */
export function leafletToGeoJson(leafletCoord) {
  let lat, lng;
  if (Array.isArray(leafletCoord) && leafletCoord.length >= 2) {
    [lat, lng] = leafletCoord;
  } else if (leafletCoord && typeof leafletCoord === 'object') {
    lat = leafletCoord.lat;
    lng = leafletCoord.lng;
  } else {
    throw new Error(`[CoordinateUtils] Invalid Leaflet coordinate: ${JSON.stringify(leafletCoord)}`);
  }

  if (!isValidLatitude(lat) || !isValidLongitude(lng)) {
    throw new Error(`[CoordinateUtils] Leaflet coordinates out of bounds: lat=${lat}, lng=${lng}`);
  }
  return [lng, lat];
}

/**
 * Validasi GeoJSON Feature / FeatureCollection
 * @param {Object} geoJson
 * @returns {{ valid: boolean, errors: string[], featureCount: number }}
 */
export function validateGeoJson(geoJson) {
  const errors = [];
  if (!geoJson || typeof geoJson !== 'object') {
    return { valid: false, errors: ['GeoJSON must be a non-null object'], featureCount: 0 };
  }

  let features = [];
  if (geoJson.type === 'FeatureCollection') {
    if (!Array.isArray(geoJson.features)) {
      errors.push('FeatureCollection must have a "features" array');
      return { valid: false, errors, featureCount: 0 };
    }
    features = geoJson.features;
  } else if (geoJson.type === 'Feature') {
    features = [geoJson];
  } else {
    errors.push(`Unsupported GeoJSON top-level type: "${geoJson.type}"`);
    return { valid: false, errors, featureCount: 0 };
  }

  features.forEach((feature, idx) => {
    const fId = feature?.properties?.id || `feature[${idx}]`;
    if (!feature || feature.type !== 'Feature') {
      errors.push(`${fId}: Missing or invalid type: "${feature?.type}"`);
      return;
    }
    if (!feature.geometry || typeof feature.geometry !== 'object') {
      errors.push(`${fId}: Missing geometry object`);
      return;
    }

    const { type, coordinates } = feature.geometry;
    if (!coordinates) {
      errors.push(`${fId}: Missing geometry coordinates`);
      return;
    }

    switch (type) {
      case 'Point':
        if (!isValidGeoJsonCoord(coordinates)) {
          errors.push(`${fId}: Invalid Point coordinates [lng, lat]: ${JSON.stringify(coordinates)}`);
        }
        break;
      case 'LineString':
        if (!Array.isArray(coordinates) || coordinates.length < 2) {
          errors.push(`${fId}: LineString must have at least 2 points`);
        } else {
          coordinates.forEach((pt, pIdx) => {
            if (!isValidGeoJsonCoord(pt)) {
              errors.push(`${fId}: Invalid LineString point[${pIdx}]: ${JSON.stringify(pt)}`);
            }
          });
        }
        break;
      case 'Polygon':
        if (!Array.isArray(coordinates) || coordinates.length === 0) {
          errors.push(`${fId}: Polygon must have at least one ring`);
        } else {
          coordinates.forEach((ring, rIdx) => {
            if (!Array.isArray(ring) || ring.length < 4) {
              errors.push(`${fId}: Polygon ring[${rIdx}] must have at least 4 points`);
            } else {
              ring.forEach((pt, pIdx) => {
                if (!isValidGeoJsonCoord(pt)) {
                  errors.push(`${fId}: Invalid Polygon point ring[${rIdx}][${pIdx}]: ${JSON.stringify(pt)}`);
                }
              });
            }
          });
        }
        break;
      default:
        errors.push(`${fId}: Unsupported geometry type "${type}"`);
    }
  });

  return {
    valid: errors.length === 0,
    errors,
    featureCount: features.length
  };
}

/**
 * VISUAL DISTANCE: Euclidean distance approximation in degrees for animation / rendering.
 * Catatan: Ini adalah visual approximation untuk rendering lerp pada layar.
 * @param {[number, number]} p1 [lng, lat] atau [lat, lng]
 * @param {[number, number]} p2 [lng, lat] atau [lat, lng]
 * @returns {number}
 */
export function calculateVisualDistance(p1, p2) {
  if (!p1 || !p2) return 0.00001;
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * OPERATIONAL DISTANCE: Haversine distance in meters for operational ETA / metrics.
 * @param {[number, number]|{lat: number, lng: number}} coord1 [lat, lng] atau {lat, lng}
 * @param {[number, number]|{lat: number, lng: number}} coord2 [lat, lng] atau {lat, lng}
 * @returns {number} Distance in meters
 */
export function calculateOperationalDistanceMeters(coord1, coord2) {
  let lat1, lon1, lat2, lon2;
  if (Array.isArray(coord1)) {
    [lat1, lon1] = coord1;
  } else {
    lat1 = coord1.lat;
    lon1 = coord1.lng;
  }

  if (Array.isArray(coord2)) {
    [lat2, lon2] = coord2;
  } else {
    lat2 = coord2.lat;
    lon2 = coord2.lng;
  }

  const R = 6371000; // Earth radius in meters
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
