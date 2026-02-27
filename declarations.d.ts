// CSS Modules
declare module "*.module.scss" {
	const classes: { readonly [key: string]: string };
	export default classes;
}

declare module "*.module.css" {
	const classes: { readonly [key: string]: string };
	export default classes;
}

// Asset imports (Vite-style)
declare module "*.svg?url" {
	const src: string;
	export default src;
}

declare module "*.png?url" {
	const src: string;
	export default src;
}
