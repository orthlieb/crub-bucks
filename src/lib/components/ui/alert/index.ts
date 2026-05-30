import Root, { type AlertProps, type AlertVariant, alertVariants } from './alert.svelte';
import Title, { type AlertTitleProps } from './alert-title.svelte';
import Description, { type AlertDescriptionProps } from './alert-description.svelte';

export {
	Root,
	Title,
	Description,
	type AlertProps as Props,
	type AlertTitleProps as TitleProps,
	type AlertDescriptionProps as DescriptionProps,
	type AlertVariant,
	alertVariants,
	//
	Root as Alert,
	Title as AlertTitle,
	Description as AlertDescription
};
