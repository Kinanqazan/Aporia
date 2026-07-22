<script lang="ts">
	import { enhance } from '$app/forms';
	import { KeyRound, ArrowRight } from 'lucide-svelte';

	let { form } = $props();
	let loading = $state(false);
</script>

<svelte:head>
	<title>Set up Aporia</title>
	<meta name="description" content="Create the password for your Aporia workspace" />
</svelte:head>

<div class="setup-container">
	<div class="setup-card">
		<div class="setup-logo-wrapper">
			<img src="/aporia-logo.svg" alt="Aporia Logo" class="setup-logo" />
			<h1>Set up Aporia</h1>
			<p class="subtitle">Create a password for your personal workspace.</p>
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
			class="setup-form"
		>
			<label>
				<span>Username</span>
				<input name="username" required minlength="3" maxlength="32" autocomplete="username" disabled={loading} />
			</label>
			<label>
				<span>Password</span>
				<input type="password" name="password" required minlength="12" disabled={loading} autocomplete="new-password" />
			</label>
			<label>
				<span>Confirm password</span>
				<input type="password" name="confirmation" required minlength="12" disabled={loading} autocomplete="new-password" />
			</label>
			<button type="submit" disabled={loading} class="submit-btn">
				{#if loading}<span class="spinner"></span>{:else}<KeyRound size={16} />{/if}
				<span>Create password</span>
				{#if !loading}<ArrowRight size={16} />{/if}
			</button>
			{#if form?.error}<div class="error-message">{form.error}</div>{/if}
		</form>

		<p class="setup-help">This is a single-user workspace. Registration closes after setup.</p>
	</div>
</div>

<style>
	.setup-container {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		width: 100%;
		background-color: var(--bg-canvas);
		padding: 24px;
	}

	.setup-card {
		width: 100%;
		max-width: 400px;
		display: flex;
		flex-direction: column;
		gap: 28px;
	}

	.setup-logo-wrapper {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 12px;
	}

	.setup-logo { width: 64px; height: 64px; margin-bottom: 8px; }
	h1 { font-size: 24px; font-weight: 600; color: var(--text-main); }
	.subtitle, .setup-help { font-size: 14px; color: var(--text-muted); line-height: 1.4; text-align: center; }
	.setup-form { display: flex; flex-direction: column; gap: 14px; }
	label { display: flex; flex-direction: column; gap: 6px; color: var(--text-muted); font-size: 13px; }
	input {
		box-sizing: border-box;
		width: 100%;
		background: var(--bg-sidebar);
		border: 1px solid var(--border-color);
		border-radius: 8px;
		padding: 11px 12px;
		font-size: 15px;
		color: var(--text-main);
	}
	input:focus { outline: 2px solid var(--selection-bg); border-color: var(--accent-color); }
	.submit-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		border-radius: 8px;
		padding: 11px 16px;
		background: var(--accent-color);
		color: white;
		font-size: 14px;
		font-weight: 600;
	}
	.submit-btn:disabled { opacity: 0.6; cursor: not-allowed; }
	.error-message { color: var(--error-color); font-size: 13px; text-align: center; }
	.spinner { width: 14px; height: 14px; border: 2px solid rgba(255,255,255,.3); border-top-color: white; border-radius: 50%; animation: spin .8s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }
</style>
