// A catalog message with its arguments in place, as the page writes it with Western digits: both
// the plain `{name}` argument and the numeral-aware `{count, number, integer}` one (the catalog
// formats counts through the reader's numerals, ADR 0035 / ACCT-B04).
export function fill(message: string, values: Record<string, string | number>) {
  return message.replace(/\{(\w+)(?:, number, integer)?\}/gu, (whole, name: string) =>
    name in values ? String(values[name]) : whole,
  );
}
