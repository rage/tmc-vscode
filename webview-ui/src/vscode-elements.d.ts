import type {
  VscodeBadge,
  VscodeButton,
  VscodeButtonGroup,
  VscodeCheckbox,
  VscodeCollapsible,
  VscodeIcon,
  VscodeProgressBar,
  VscodeProgressRing,
  VscodeRadio,
  VscodeRadioGroup,
  VscodeTable,
  VscodeTableBody,
  VscodeTableCell,
  VscodeTableHeader,
  VscodeTableHeaderCell,
  VscodeTableRow,
  VscodeTextarea,
  VscodeToolbarButton,
} from "@vscode-elements/elements"
import type { HTMLAttributes } from "svelte/elements"

/**
 * Markup typing for a `vscode-*` element: its HTML attributes, the listed Lit properties (typed
 * from the class, so they follow library upgrades), and `Extra` for kebab-case attribute-only
 * names. Only value types are checked; a misspelt attribute name still passes.
 */
type VscodeElementAttributes<
  E extends HTMLElement,
  K extends keyof E = never,
  Extra = object,
> = HTMLAttributes<E> & { [P in K]?: E[P] | undefined } & Extra

interface VscodeElements {
  "vscode-badge": VscodeElementAttributes<VscodeBadge, "variant">
  "vscode-button": VscodeElementAttributes<
    VscodeButton,
    "disabled" | "secondary" | "icon" | "block" | "type" | "value" | "name",
    {
      "icon-after"?: string | undefined
      "icon-only"?: boolean | undefined
      "icon-spin"?: boolean | undefined
    }
  >
  "vscode-button-group": VscodeElementAttributes<VscodeButtonGroup>
  "vscode-checkbox": VscodeElementAttributes<
    VscodeCheckbox,
    "checked" | "indeterminate" | "disabled" | "label" | "toggle" | "value" | "name"
  >
  "vscode-collapsible": VscodeElementAttributes<
    VscodeCollapsible,
    "heading" | "description" | "open",
    {
      "always-show-header-actions"?: boolean | undefined
      "onvsc-collapsible-toggle"?: ((event: CustomEvent<{ open: boolean }>) => void) | undefined
    }
  >
  "vscode-icon": VscodeElementAttributes<
    VscodeIcon,
    "name" | "size" | "spin" | "label",
    { "action-icon"?: boolean | undefined }
  >
  "vscode-progress-bar": VscodeElementAttributes<
    VscodeProgressBar,
    "value" | "max" | "indeterminate"
  >
  "vscode-progress-ring": VscodeElementAttributes<VscodeProgressRing>
  "vscode-radio": VscodeElementAttributes<
    VscodeRadio,
    "checked" | "disabled" | "label" | "name" | "value"
  >
  "vscode-radio-group": VscodeElementAttributes<VscodeRadioGroup, "variant">
  "vscode-table": VscodeElementAttributes<
    VscodeTable,
    "zebra" | "responsive" | "breakpoint" | "bordered" | "resizable" | "columns" | "compact"
  >
  "vscode-table-body": VscodeElementAttributes<VscodeTableBody>
  "vscode-table-cell": VscodeElementAttributes<
    VscodeTableCell,
    "compact",
    { "column-label"?: string | undefined }
  >
  "vscode-table-header": VscodeElementAttributes<VscodeTableHeader>
  "vscode-table-header-cell": VscodeElementAttributes<VscodeTableHeaderCell>
  "vscode-table-row": VscodeElementAttributes<VscodeTableRow>
  "vscode-textarea": VscodeElementAttributes<
    VscodeTextarea,
    "value" | "label" | "placeholder" | "rows" | "disabled" | "readonly" | "resize" | "name"
  >
  "vscode-toolbar-button": VscodeElementAttributes<
    VscodeToolbarButton,
    "icon" | "label" | "toggleable" | "checked"
  >
}

declare module "svelte/elements" {
  // oxlint-disable-next-line typescript/no-empty-object-type -- interface merging needs `extends`
  export interface SvelteHTMLElements extends VscodeElements {}
}

// svelte-check's `--tsgo` mode types markup from this namespace rather than `SvelteHTMLElements`.
declare global {
  namespace svelteHTML {
    // oxlint-disable-next-line typescript/no-empty-object-type -- interface merging needs `extends`
    interface IntrinsicElements extends VscodeElements {}
  }
}
