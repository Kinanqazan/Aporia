<script lang="ts">
	import { Plus, BookOpen } from 'lucide-svelte';
	import { enhance } from '$app/forms';

	let { data } = $props();
</script>

{#if data.isEmptyWorkspace}
	<div class="welcome-screen">
		<div class="welcome-icon">📓</div>
		<h1 class="welcome-title">Welcome to Quiet Pages</h1>
		<p class="welcome-subtitle">
			A private, local-first space for your thoughts. Create your first page in the sidebar or click the button below to get started.
		</p>
		
		<form method="POST" action="?/create" use:enhance>
			<input type="hidden" name="parentId" value="null" />
			<input type="hidden" name="title" value="Getting Started 🚀" />
			<input type="hidden" name="icon" value="🚀" />
			<button type="submit" class="create-first-page-btn">
				<Plus size={16} />
				<span>Create First Page</span>
			</button>
		</form>
	</div>
{/if}

<style>
	.welcome-screen {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		height: calc(100vh - 200px);
		max-width: 480px;
		margin: 0 auto;
		padding: 24px;
	}

	.welcome-icon {
		font-size: 80px;
		line-height: 1;
		margin-bottom: 24px;
		user-select: none;
	}

	.welcome-title {
		font-size: 28px;
		font-weight: 700;
		color: var(--text-main);
		margin-bottom: 12px;
	}

	.welcome-subtitle {
		font-size: 15px;
		color: var(--text-muted);
		line-height: 1.6;
		margin-bottom: 32px;
	}

	.create-first-page-btn {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		background-color: var(--accent-color);
		color: white;
		padding: 10px 20px;
		border-radius: 6px;
		font-size: 14px;
		font-weight: 600;
		box-shadow: 0 2px 8px rgba(35, 131, 226, 0.2);
		transition: transform 0.15s, opacity 0.15s;
	}

	.create-first-page-btn:hover {
		opacity: 0.9;
		transform: translateY(-1px);
	}

	.create-first-page-btn:active {
		transform: translateY(0);
	}
</style>
