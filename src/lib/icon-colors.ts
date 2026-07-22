export const ICON_COLORS = [
	{ value: null, label: 'Default' },
	{ value: '#e86666', label: 'Red' },
	{ value: '#f97316', label: 'Orange' },
	{ value: '#eab308', label: 'Yellow' },
	{ value: '#22c55e', label: 'Green' },
	{ value: '#3b82f6', label: 'Blue' },
	{ value: '#8b5cf6', label: 'Purple' },
	{ value: '#ec4899', label: 'Pink' },
	{ value: '#64748b', label: 'Slate' }
] as const;

const iconColorValues: Set<string> = new Set(
	ICON_COLORS.flatMap((color) => color.value ? [color.value] : [])
);

export function normalizeIconColor(value: string | null | undefined): string | null {
	if (!value || value === 'default') return null;
	const normalized = value.trim().toLowerCase();
	return iconColorValues.has(normalized) ? normalized : null;
}
