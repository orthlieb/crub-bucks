import tippy, { followCursor } from 'tippy.js';
import 'tippy.js/dist/tippy.css';
import './tooltip.css'; // 'crub' theme using the app's popover tokens

/**
 * Svelte action: `use:tooltip={text}`. A tippy.js tooltip that follows the
 * cursor, themed to the app's popover colors. Pass an empty string to disable.
 */
export function tooltip(node: HTMLElement, content: string) {
	// Make non-interactive triggers focusable so the tooltip also opens on
	// keyboard focus and on tap (mobile has no hover). Set imperatively to avoid
	// a markup a11y warning for tabindex on a non-interactive element.
	const managedTabIndex = node.tabIndex < 0;
	if (managedTabIndex) node.tabIndex = 0;

	const instance = tippy(node, {
		content,
		plugins: [followCursor],
		followCursor: true,
		// mouseenter (desktop hover) + focus (keyboard/tab); touch taps focus too.
		trigger: 'mouseenter focus',
		touch: true,
		theme: 'crub',
		delay: [120, 0],
		arrow: false,
		offset: [0, 14],
		allowHTML: false
	});
	if (!content) instance.disable();

	return {
		update(next: string) {
			instance.setContent(next);
			if (next) instance.enable();
			else instance.disable();
		},
		destroy() {
			instance.destroy();
			if (managedTabIndex) node.removeAttribute('tabindex');
		}
	};
}
