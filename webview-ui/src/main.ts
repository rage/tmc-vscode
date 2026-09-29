import { mount } from "svelte"

import "./elements"

import "./styles/tokens.css"
import "./styles/base.css"
import App from "./App.svelte"

const app = mount(App, {
  target: document.body,
})

export default app
