import { Dialog as DialogPrimitive } from 'bits-ui';

import Content, { type DialogContentProps } from './dialog-content.svelte';
import Overlay, { type DialogOverlayProps } from './dialog-overlay.svelte';
import Title, { type DialogTitleProps } from './dialog-title.svelte';
import Description, { type DialogDescriptionProps } from './dialog-description.svelte';
import Footer, { type DialogFooterProps } from './dialog-footer.svelte';

const Root = DialogPrimitive.Root;
const Trigger = DialogPrimitive.Trigger;
const Close = DialogPrimitive.Close;
const Portal = DialogPrimitive.Portal;

export {
	Root,
	Trigger,
	Close,
	Portal,
	Content,
	Overlay,
	Title,
	Description,
	Footer,
	type DialogContentProps as ContentProps,
	type DialogOverlayProps as OverlayProps,
	type DialogTitleProps as TitleProps,
	type DialogDescriptionProps as DescriptionProps,
	type DialogFooterProps as FooterProps,
	//
	Root as Dialog,
	Trigger as DialogTrigger,
	Close as DialogClose,
	Portal as DialogPortal,
	Content as DialogContent,
	Overlay as DialogOverlay,
	Title as DialogTitle,
	Description as DialogDescription,
	Footer as DialogFooter
};
