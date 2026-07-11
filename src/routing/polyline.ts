import type { LatLng } from "../geo/types";

/**
 * Decodes a Google-encoded polyline (the format returned by Directions API's
 * `overview_polyline.points`, precision 5) into an ordered list of
 * coordinates. Pure function, no provider dependency, so it can be unit
 * tested directly with a literal encoded string.
 *
 * Algorithm reference: https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */
export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    lat += decodeSignedValue();
    lng += decodeSignedValue();
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }

  return points;

  function decodeSignedValue(): number {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  }
}
