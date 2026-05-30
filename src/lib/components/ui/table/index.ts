import Root, { type TableProps } from './table.svelte';
import Header, { type TableHeaderProps } from './table-header.svelte';
import Body, { type TableBodyProps } from './table-body.svelte';
import Row, { type TableRowProps } from './table-row.svelte';
import Head, { type TableHeadProps } from './table-head.svelte';
import Cell, { type TableCellProps } from './table-cell.svelte';
import Caption, { type TableCaptionProps } from './table-caption.svelte';

export {
	Root,
	Header,
	Body,
	Row,
	Head,
	Cell,
	Caption,
	type TableProps as Props,
	type TableHeaderProps as HeaderProps,
	type TableBodyProps as BodyProps,
	type TableRowProps as RowProps,
	type TableHeadProps as HeadProps,
	type TableCellProps as CellProps,
	type TableCaptionProps as CaptionProps,
	//
	Root as Table,
	Header as TableHeader,
	Body as TableBody,
	Row as TableRow,
	Head as TableHead,
	Cell as TableCell,
	Caption as TableCaption
};
