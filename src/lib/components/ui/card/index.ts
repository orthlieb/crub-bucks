import Root, { type CardProps } from './card.svelte';
import Header, { type CardHeaderProps } from './card-header.svelte';
import Title, { type CardTitleProps } from './card-title.svelte';
import Description, { type CardDescriptionProps } from './card-description.svelte';
import Content, { type CardContentProps } from './card-content.svelte';
import Footer, { type CardFooterProps } from './card-footer.svelte';

export {
	Root,
	Header,
	Title,
	Description,
	Content,
	Footer,
	type CardProps as Props,
	type CardHeaderProps as HeaderProps,
	type CardTitleProps as TitleProps,
	type CardDescriptionProps as DescriptionProps,
	type CardContentProps as ContentProps,
	type CardFooterProps as FooterProps,
	//
	Root as Card,
	Header as CardHeader,
	Title as CardTitle,
	Description as CardDescription,
	Content as CardContent,
	Footer as CardFooter
};
