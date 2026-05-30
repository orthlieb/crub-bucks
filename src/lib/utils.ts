import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Combine class names. Mirrors the shadcn/ui convention: `clsx` accepts the
 * Svelte/React variadic forms (string, array, object) and `twMerge` resolves
 * Tailwind conflicts so the last-passed utility wins.
 */
export function cn(...inputs: ClassValue[]): string {
	return twMerge(clsx(inputs));
}

/** Re-export ClassValue so component prop types can reuse it. */
export type { ClassValue } from 'clsx';
