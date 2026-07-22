<script lang="ts">
	import { enhance } from '$app/forms';
	import { ArrowLeft, KeyRound } from 'lucide-svelte';

	let { form } = $props();
	let loading = $state(false);
</script>

<svelte:head>
	<title>Change password - Aporia</title>
</svelte:head>

<div class="password-container">
	<div class="password-card">
		<div class="heading">
			<KeyRound size={28} />
			<h1>Change password</h1>
			<p>Update the password for your Aporia workspace.</p>
		</div>
		<form method="POST" use:enhance={() => { loading = true; return async ({ update }) => { loading = false; await update(); }; }}>
			<label>Current password<input type="password" name="currentPassword" required disabled={loading} autocomplete="current-password" /></label>
			<label>New password<input type="password" name="newPassword" required minlength="12" disabled={loading} autocomplete="new-password" /></label>
			<label>Confirm new password<input type="password" name="confirmation" required minlength="12" disabled={loading} autocomplete="new-password" /></label>
			<button type="submit" disabled={loading}>Change password</button>
		</form>
		{#if form?.error}<div class="error">{form.error}</div>{/if}
		<a href="/"> <ArrowLeft size={15} /> Back to workspace</a>
	</div>
</div>

<style>
	.password-container { display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 24px; background: var(--bg-canvas); }
	.password-card { width: 100%; max-width: 400px; display: flex; flex-direction: column; gap: 22px; }
	.heading { display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center; color: var(--text-muted); }
	.heading h1 { color: var(--text-main); font-size: 24px; font-weight: 600; }
	.heading p { font-size: 14px; }
	form { display: flex; flex-direction: column; gap: 14px; }
	label { display: flex; flex-direction: column; gap: 6px; color: var(--text-muted); font-size: 13px; }
	input { box-sizing: border-box; width: 100%; padding: 11px 12px; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-sidebar); color: var(--text-main); font-size: 15px; }
	button { padding: 11px 16px; border-radius: 8px; background: var(--accent-color); color: white; font-weight: 600; }
	button:disabled { opacity: .6; }
	.error { color: var(--error-color); font-size: 13px; text-align: center; }
	a { display: inline-flex; align-items: center; justify-content: center; gap: 6px; color: var(--text-muted); font-size: 14px; }
</style>
