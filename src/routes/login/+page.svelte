<script lang="ts">
	import { enhance } from '$app/forms';
	import { Lock, ArrowRight } from 'lucide-svelte';

	let { form } = $props();
	let loading = $state(false);
</script>

<svelte:head>
	<title>Login - Aporia</title>
	<meta name="description" content="Access your personal workspace on Aporia" />
</svelte:head>

<div class="login-container">
	<div class="login-card">
		<div class="login-logo-wrapper">
			<img src="/logo.svg" alt="Aporia Logo" class="login-logo" />
		<h1>Aporia</h1>
			<p class="subtitle">Enter password to unlock your personal workspace</p>
		</div>

		<form 
			method="POST" 
			use:enhance={() => {
				loading = true;
				return async ({ update }) => {
					loading = false;
					await update();
				};
			}}
			class="login-form"
		>
			<div class="input-wrapper" class:has-error={form?.incorrect}>
				<Lock size={16} class="input-icon" />
				<input 
					type="password" 
					name="password" 
					placeholder="Workspace password..." 
					required 
					disabled={loading}
					autocomplete="current-password"
				/>
				<button type="submit" disabled={loading} aria-label="Unlock" class="submit-btn">
					{#if loading}
						<div class="spinner"></div>
					{:else}
						<ArrowRight size={16} />
					{/if}
				</button>
			</div>

			{#if form?.error}
				<div class="error-message">
					{form.error}
				</div>
			{/if}
		</form>
	</div>
</div>

<style>
	.login-container {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		width: 100vw;
		background-color: var(--bg-canvas);
		padding: 24px;
	}

	.login-card {
		width: 100%;
		max-width: 400px;
		display: flex;
		flex-direction: column;
		gap: 32px;
		animation: cardSlideUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
	}

	@keyframes cardSlideUp {
		from {
			opacity: 0;
			transform: translateY(16px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.login-logo-wrapper {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 12px;
	}

	.login-logo {
		width: 64px;
		height: 64px;
		margin-bottom: 8px;
	}

	h1 {
		font-size: 24px;
		font-weight: 600;
		color: var(--text-main);
	}

	.subtitle {
		font-size: 14px;
		color: var(--text-muted);
		line-height: 1.4;
	}

	.login-form {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.input-wrapper {
		display: flex;
		align-items: center;
		background-color: var(--bg-sidebar);
		border: 1px solid var(--border-color);
		border-radius: 8px;
		padding: 10px 14px;
		gap: 12px;
		transition: border-color var(--transition-speed), box-shadow var(--transition-speed);
	}

	.input-wrapper:focus-within {
		border-color: var(--accent-color);
		box-shadow: 0 0 0 2px var(--selection-bg);
	}

	.input-wrapper.has-error {
		border-color: var(--error-color);
		animation: shake 0.4s ease-in-out;
	}

	@keyframes shake {
		0%, 100% { transform: translateX(0); }
		20%, 60% { transform: translateX(-4px); }
		40%, 80% { transform: translateX(4px); }
	}

	:global(.input-icon) {
		color: var(--text-muted);
		flex-shrink: 0;
	}

	input {
		flex: 1;
		background: transparent;
		border: none;
		outline: none;
		font-size: 15px;
		color: var(--text-main);
	}

	input::placeholder {
		color: var(--text-muted);
	}

	.submit-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border-radius: 6px;
		background-color: var(--accent-color);
		color: white;
		transition: opacity var(--transition-speed);
	}

	.submit-btn:hover {
		opacity: 0.9;
		background-color: var(--accent-color);
	}

	.submit-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.error-message {
		font-size: 13px;
		color: var(--error-color);
		text-align: center;
		margin-top: 4px;
	}

	.spinner {
		width: 14px;
		height: 14px;
		border: 2px solid rgba(255, 255, 255, 0.3);
		border-top-color: white;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}
</style>
