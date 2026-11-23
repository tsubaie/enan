import { z } from 'zod';
// CAPTURES-B16: where the record control lives. The workspace stores a concrete placement; a member
// stores a choice, where `workspace` means "follow the workspace" and is never written (the row is
// cleared instead, ACCT-I03). The floating side is logical, never left or right.
export const MobilePlacement = z.enum(['floating-end', 'floating-start', 'more']);
export const DesktopPlacement = z.enum(['header', 'account-menu', 'hidden']);
export const MobileChoice = z.enum(['workspace', 'floating', 'more']);
export const FloatingSide = z.enum(['end', 'start']);
export const DesktopChoice = z.enum(['workspace', 'header', 'account-menu', 'hidden']);
export type MobilePlacement = z.infer<typeof MobilePlacement>;
export type DesktopPlacement = z.infer<typeof DesktopPlacement>;
export type MobileChoice = z.infer<typeof MobileChoice>;
export type FloatingSide = z.infer<typeof FloatingSide>;
export type DesktopChoice = z.infer<typeof DesktopChoice>;
