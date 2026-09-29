import { mount } from "svelte"

import "./elements"

import "./styles/tokens.css"
import "./styles/base.css"
import App from "./App.svelte"
import { mountAnnouncer } from "./utilities/a11y.svelte"

mountAnnouncer()

const app = mount(App, {
  target: document.body,
})

export default app
