'use client';
import { LanguageToggle } from './LanguageToggle';
// The sign-in page's preferences: the same flag toggle the workspace header carries, so the
// language is chosen the same way before and after signing in.
export function Preferences() {
  return <LanguageToggle />;
}
