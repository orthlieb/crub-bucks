<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import * as Dialog from '$lib/components/ui/dialog';
	import Flag from '@lucide/svelte/icons/flag';

	let {
		targetType,
		targetId,
		targetLabel,
		content = null,
		triggerVariant = 'ghost',
		triggerLabel = 'Report',
		iconOnly = false
	}: {
		targetType: 'user' | 'bet';
		targetId: string;
		targetLabel: string;
		/** Snapshot of the offending text included in the report email. */
		content?: string | null;
		triggerVariant?: 'ghost' | 'outline';
		triggerLabel?: string;
		/** Render just a flag icon button (for tight rows). */
		iconOnly?: boolean;
	} = $props();

	let open = $state(false);
	let reason = $state('');
	let sent = $state(false);
	let submitting = $state(false);
	let errorMsg = $state('');

	function reset() {
		sent = false;
		submitting = false;
		errorMsg = '';
		reason = '';
	}
</script>

{#if iconOnly}
	<Button
		type="button"
		variant={triggerVariant}
		size="icon"
		aria-label={`Report ${targetLabel}`}
		title="Report"
		onclick={() => (open = true)}
	>
		<Flag class="size-4" />
	</Button>
{:else}
	<Button
		type="button"
		variant={triggerVariant}
		size="sm"
		class="gap-1.5"
		onclick={() => (open = true)}
	>
		<Flag class="size-4" />
		{triggerLabel}
	</Button>
{/if}

<Dialog.Root
	bind:open
	onOpenChange={(o) => {
		if (o) reset();
	}}
>
	<Dialog.Content class="max-w-md">
		<Dialog.Title>Report {targetType === 'bet' ? 'this bet' : 'this name'}</Dialog.Title>
		<Dialog.Description>
			This goes to the Crub Bucks team to review. Reporting “{targetLabel}”.
		</Dialog.Description>

		{#if sent}
			<p class="text-sm text-success">Thanks — we'll take a look.</p>
			<Dialog.Footer>
				<Button type="button" onclick={() => (open = false)}>Close</Button>
			</Dialog.Footer>
		{:else}
			<form
				method="POST"
				action="/app/report"
				use:enhance={() => {
					submitting = true;
					return async ({ result }) => {
						submitting = false;
						if (result.type === 'success') sent = true;
						else if (result.type === 'failure')
							errorMsg = String(
								result.data?.error ?? 'Could not send the report. Please try again.'
							);
						else errorMsg = 'Could not send the report. Please try again.';
					};
				}}
				class="space-y-3"
			>
				<input type="hidden" name="targetType" value={targetType} />
				<input type="hidden" name="targetId" value={targetId} />
				<input type="hidden" name="targetLabel" value={targetLabel} />
				{#if content}<input type="hidden" name="content" value={content} />{/if}

				<div class="space-y-1">
					<Label for="report-reason">What's wrong? (optional)</Label>
					<textarea
						id="report-reason"
						name="reason"
						bind:value={reason}
						maxlength={500}
						rows={3}
						placeholder="Tell us what's not OK about it."
						class="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
					></textarea>
				</div>

				{#if errorMsg}<p class="text-sm text-destructive">{errorMsg}</p>{/if}

				<Dialog.Footer>
					<Button type="button" variant="outline" onclick={() => (open = false)}>Cancel</Button>
					<Button type="submit" disabled={submitting}>Send report</Button>
				</Dialog.Footer>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>
