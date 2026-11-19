// Vite bundles imported stylesheets into bundle.css; `?raw` yields the file's text.
declare module "*.css" {}

declare module "*.css?raw" {
  const content: string
  export default content
}
