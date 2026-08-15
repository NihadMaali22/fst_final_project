/**
 * Builds an index-usable SQL predicate for an `attr.<key>=<value>` filter.
 *
 * The obvious form, `attributes->>'key' = 'value'`, cannot use a GIN index: the
 * planner has no operator class for `->>`, so every row in the time range gets its
 * JSONB detoasted and probed. Containment (`@>`) is backed by
 * `idx_logs_attrs (attributes jsonb_path_ops)`, so non-matching rows are never read.
 *
 * Containment is type-exact, while `->>` compares the text projection, so a single
 * `@>` is not equivalent on its own. The validator admits only string, number and
 * boolean attribute values, so ORing one containment per candidate type reproduces
 * `->>` semantics exactly — and each branch is independently indexable, which the
 * planner combines with a BitmapOr.
 *
 * The numeric variant is emitted only when the value is its own canonical JSON
 * rendering: '3' round-trips to 3, so a stored number 3 must match, whereas '3.0'
 * does not round-trip and `->>` would have compared '3' against '3.0' and failed.
 * Skipping it there keeps the two forms in agreement.
 */
export function buildAttributeContainmentSql(
  attrKey: string,
  rawValue: string,
  bind: (value: unknown) => string
): string {
  const variants: string[] = [JSON.stringify({ [attrKey]: rawValue })];

  const asNumber = Number(rawValue);
  if (rawValue.trim() !== '' && Number.isFinite(asNumber) && String(asNumber) === rawValue) {
    variants.push(JSON.stringify({ [attrKey]: asNumber }));
  }

  if (rawValue === 'true') variants.push(JSON.stringify({ [attrKey]: true }));
  if (rawValue === 'false') variants.push(JSON.stringify({ [attrKey]: false }));

  const predicates = variants.map((json) => `attributes @> ${bind(json)}::jsonb`);
  return predicates.length === 1 ? predicates[0] : `(${predicates.join(' OR ')})`;
}
