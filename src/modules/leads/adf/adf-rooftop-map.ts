import { RooftopId } from '../../../common/enums';

/**
 * Mapping of DealerSocket Vendor / Rooftop identifiers, DealerSocket Dealership IDs,
 * or DMS dealer names to the system's RooftopId enum.
 */
export const ADF_ROOFTOP_MAP: Record<string, RooftopId> = {
  // Kia mappings
  'cranbourne_kia': RooftopId.CRANBOURNE_KIA,
  'kia': RooftopId.CRANBOURNE_KIA,
  'cranbourne kia': RooftopId.CRANBOURNE_KIA,
  'booran kia': RooftopId.CRANBOURNE_KIA,
  'kia cranbourne': RooftopId.CRANBOURNE_KIA,
  'kia_cranbourne': RooftopId.CRANBOURNE_KIA,
  'ds_kia_001': RooftopId.CRANBOURNE_KIA,

  // MG mappings
  'cranbourne_mg': RooftopId.CRANBOURNE_MG,
  'mg': RooftopId.CRANBOURNE_MG,
  'cranbourne mg': RooftopId.CRANBOURNE_MG,
  'booran mg': RooftopId.CRANBOURNE_MG,
  'mg cranbourne': RooftopId.CRANBOURNE_MG,
  'mg_cranbourne': RooftopId.CRANBOURNE_MG,
  'ds_mg_002': RooftopId.CRANBOURNE_MG,

  // Geely mappings
  'geely_cranbourne': RooftopId.GEELY_CRANBOURNE,
  'geely': RooftopId.GEELY_CRANBOURNE,
  'geely cranbourne': RooftopId.GEELY_CRANBOURNE,
  'booran geely': RooftopId.GEELY_CRANBOURNE,
  'ds_geely_003': RooftopId.GEELY_CRANBOURNE,
};

export function resolveRooftopId(rawIdOrName?: string): RooftopId {
  if (!rawIdOrName) {
    return RooftopId.CRANBOURNE_KIA; // default fallback if unassigned
  }

  const normalized = rawIdOrName.trim().toLowerCase();

  if (ADF_ROOFTOP_MAP[normalized]) {
    return ADF_ROOFTOP_MAP[normalized];
  }

  // Substring checks
  if (normalized.includes('kia')) return RooftopId.CRANBOURNE_KIA;
  if (normalized.includes('mg')) return RooftopId.CRANBOURNE_MG;
  if (normalized.includes('geely')) return RooftopId.GEELY_CRANBOURNE;

  return RooftopId.CRANBOURNE_KIA;
}
