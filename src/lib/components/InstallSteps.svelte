<script lang="ts">
	import SquareArrowUp from '@lucide/svelte/icons/square-arrow-up';
	import EllipsisVertical from '@lucide/svelte/icons/ellipsis-vertical';
</script>

<div class="grid gap-4 sm:grid-cols-2">
	<div class="space-y-1 text-sm">
		<div class="font-medium">iPhone / iPad — Safari</div>
		<ol class="list-decimal space-y-1 pl-5 text-muted-foreground">
			<li>
				Tap the
				<span class="inline-flex items-center gap-1 font-medium text-foreground">
					Share <SquareArrowUp class="inline size-4" />
				</span>
				button.
			</li>
			<li>Choose <span class="font-medium text-foreground">Add to Home Screen</span>.</li>
			<li>Tap <span class="font-medium text-foreground">Add</span>.</li>
		</ol>
	</div>
	<div class="space-y-1 text-sm">
		<div class="font-medium">Android — Chrome</div>
		<ol class="list-decimal space-y-1 pl-5 text-muted-foreground">
			<li>
				Tap the
				<span class="inline-flex items-center gap-1 font-medium text-foreground">
					menu <EllipsisVertical class="inline size-4" />
				</span>.
			</li>
			<li>
				Choose <span class="font-medium text-foreground">Install app</span>
				(or <span class="font-medium text-foreground">Add to Home screen</span>).
			</li>
			<li>Confirm <span class="font-medium text-foreground">Install</span>.</li>
		</ol>
	</div>
</div>
