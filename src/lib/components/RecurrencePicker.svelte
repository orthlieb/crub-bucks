<script lang="ts">
	import { Input } from '$lib/components/ui/input';

	// A Google-Calendar-style recurrence picker. Emits plain form fields (mode,
	// weekdays[], monthday, nthPos, nthWeekday, month, interval, customFreq,
	// endMode, count, until) that the server parses into a RecurrenceInput. The
	// server's buildRecurrence() is the source of truth for validation.
	let {
		mode = $bindable('weekly'),
		weekdays = $bindable<string[]>(['MO']),
		monthday = $bindable(1),
		nthPos = $bindable(1),
		nthWeekday = $bindable('MO'),
		month = $bindable(1),
		interval = $bindable(1),
		customFreq = $bindable('week'),
		endMode = $bindable('never'),
		count = $bindable(1),
		until = $bindable('')
	}: {
		mode?: string;
		weekdays?: string[];
		monthday?: number;
		nthPos?: number;
		nthWeekday?: string;
		month?: number;
		interval?: number;
		customFreq?: string;
		endMode?: string;
		count?: number;
		until?: string;
	} = $props();

	const DAYS = [
		{ v: 'MO', label: 'Mon' },
		{ v: 'TU', label: 'Tue' },
		{ v: 'WE', label: 'Wed' },
		{ v: 'TH', label: 'Thu' },
		{ v: 'FR', label: 'Fri' },
		{ v: 'SA', label: 'Sat' },
		{ v: 'SU', label: 'Sun' }
	];
	const NTH = [
		{ v: 1, label: 'first' },
		{ v: 2, label: 'second' },
		{ v: 3, label: 'third' },
		{ v: 4, label: 'fourth' },
		{ v: -1, label: 'last' }
	];
	const MONTHS = [
		'January',
		'February',
		'March',
		'April',
		'May',
		'June',
		'July',
		'August',
		'September',
		'October',
		'November',
		'December'
	];

	const selectClass =
		'h-9 rounded-md border border-input bg-transparent px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring';

	function toggleDay(v: string) {
		weekdays = weekdays.includes(v) ? weekdays.filter((d) => d !== v) : [...weekdays, v];
	}
</script>

<!-- Hidden inputs carry the current selection into the form submit. Only the
     fields relevant to the chosen mode need to post, but posting them all is
     harmless — the server reads what it needs per mode. -->
<input type="hidden" name="mode" value={mode} />
{#each weekdays as w (w)}
	<input type="hidden" name="weekdays" value={w} />
{/each}
<input type="hidden" name="monthday" value={monthday} />
<input type="hidden" name="nthPos" value={nthPos} />
<input type="hidden" name="nthWeekday" value={nthWeekday} />
<input type="hidden" name="month" value={month} />
<input type="hidden" name="interval" value={interval} />
<input type="hidden" name="customFreq" value={customFreq} />
<input type="hidden" name="endMode" value={endMode} />
<input type="hidden" name="count" value={count} />
<input type="hidden" name="until" value={until} />

<div class="space-y-3 rounded-md border bg-muted/30 p-3">
	<label class="flex items-center gap-2 text-sm">
		<span class="text-muted-foreground">Repeats</span>
		<select bind:value={mode} class={selectClass}>
			<option value="daily">Daily</option>
			<option value="weekday">Every weekday (Mon–Fri)</option>
			<option value="weekly">Weekly on…</option>
			<option value="monthly_day">Monthly on a day</option>
			<option value="monthly_nth">Monthly on the…</option>
			<option value="yearly">Annually on…</option>
			<option value="custom">Custom…</option>
		</select>
	</label>

	{#if mode === 'weekly'}
		<div class="flex flex-wrap gap-1">
			{#each DAYS as d (d.v)}
				<button
					type="button"
					onclick={() => toggleDay(d.v)}
					aria-pressed={weekdays.includes(d.v)}
					class="h-8 w-11 rounded-md border text-xs font-medium transition-colors {weekdays.includes(
						d.v
					)
						? 'border-primary bg-primary text-primary-foreground'
						: 'border-input bg-transparent text-muted-foreground hover:bg-muted'}"
				>
					{d.label}
				</button>
			{/each}
		</div>
	{:else if mode === 'monthly_day'}
		<label class="flex items-center gap-2 text-sm">
			<span class="text-muted-foreground">On day</span>
			<Input type="number" min="1" max="31" bind:value={monthday} class="w-20" />
			<span class="text-muted-foreground">of the month</span>
		</label>
	{:else if mode === 'monthly_nth'}
		<div class="flex flex-wrap items-center gap-2 text-sm">
			<span class="text-muted-foreground">On the</span>
			<select bind:value={nthPos} class={selectClass}>
				{#each NTH as n (n.v)}
					<option value={n.v}>{n.label}</option>
				{/each}
			</select>
			<select bind:value={nthWeekday} class={selectClass}>
				{#each DAYS as d (d.v)}
					<option value={d.v}>{d.label}</option>
				{/each}
			</select>
		</div>
	{:else if mode === 'yearly'}
		<div class="flex flex-wrap items-center gap-2 text-sm">
			<span class="text-muted-foreground">On</span>
			<select bind:value={month} class={selectClass}>
				{#each MONTHS as name, i (name)}
					<option value={i + 1}>{name}</option>
				{/each}
			</select>
			<Input type="number" min="1" max="31" bind:value={monthday} class="w-20" />
		</div>
	{:else if mode === 'custom'}
		<div class="space-y-2">
			<div class="flex flex-wrap items-center gap-2 text-sm">
				<span class="text-muted-foreground">Every</span>
				<Input type="number" min="1" bind:value={interval} class="w-20" />
				<select bind:value={customFreq} class={selectClass}>
					<option value="day">day(s)</option>
					<option value="week">week(s)</option>
					<option value="month">month(s)</option>
					<option value="year">year(s)</option>
				</select>
			</div>
			<div class="flex flex-wrap items-center gap-2 text-sm">
				<span class="text-muted-foreground">Ends</span>
				<select bind:value={endMode} class={selectClass}>
					<option value="never">Never</option>
					<option value="count">After N times</option>
					<option value="until">On date</option>
				</select>
				{#if endMode === 'count'}
					<Input type="number" min="1" bind:value={count} class="w-20" />
					<span class="text-muted-foreground">times</span>
				{:else if endMode === 'until'}
					<Input type="date" bind:value={until} class="w-40" />
				{/if}
			</div>
		</div>
	{/if}
</div>
