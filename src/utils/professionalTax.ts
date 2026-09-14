// Professional Tax by registered work location. Matched case-insensitively (and trimmed) so
// "Bangalore", "BANGALORE", " Bangalore " etc. all resolve the same way. Any location not
// explicitly listed (including blank/unknown) has no PT slab defined here, so it's 0.
const PT_BY_LOCATION: Record<string, number> = {
  bangalore: 200,
  chennai: 208,
};

export function professionalTaxForLocation(location: string | null | undefined): number {
  const key = (location || '').trim().toLowerCase();
  return PT_BY_LOCATION[key] ?? 0;
}
