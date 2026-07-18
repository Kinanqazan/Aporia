<script lang="ts">
	import { iconMap } from '$lib/icons';

	let { icon, size = 16, className = '' } = $props();

	// Default to lucide:file-text if no icon is set
	const activeIcon = $derived(icon || 'lucide:file-text');

	// Check if it's a lucide icon name (e.g. "lucide:book-open")
	const isLucide = $derived(activeIcon?.startsWith('lucide:'));
	const lucideName = $derived(isLucide ? activeIcon.substring(7) : '');
	const IconComponent = $derived(isLucide ? iconMap[lucideName] : null);
</script>

{#if IconComponent}
	<span class="svelte-page-icon {className}">
		<IconComponent {size} color="currentColor" strokeWidth={1.5} />
	</span>
{:else}
	<span class="svelte-page-icon {className}">{activeIcon}</span>
{/if}

<style>
	.svelte-page-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}
</style>
