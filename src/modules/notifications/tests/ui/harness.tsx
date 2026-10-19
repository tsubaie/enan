// The shared component harness (tests/fixtures/mount.tsx), under the name the bell's scenarios import.
export { mount } from '../../../../../tests/fixtures/mount';
// One branch of an ICU plural message, as the catalogue writes it, with the count in place of `#`
// or of the formatted `{count, number, integer}` argument.
export function plural(message: string, branch: string, count?: number) {
  const text = new RegExp(`\\b${branch} \\{((?:[^{}]|\\{[^{}]*\\})*)\\}`, 'u').exec(message)?.[1];
  if (!text) throw new Error(`no ${branch} branch in ${message}`);
  return count === undefined ? text : text.replace(/#|\{count[^}]*\}/u, String(count));
}
