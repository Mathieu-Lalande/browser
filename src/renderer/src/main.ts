import { mount } from "svelte";
import App from "./App.svelte";
import { browser } from "./lib/browser.svelte";
import { settings } from "./lib/settings.svelte";
import { applyTheme } from "./lib/theme";
import "./styles/global.css";

document.documentElement.dataset.platform = window.platform;

// The saved theme (or the private one) is applied before the first render: no flash of the default colors.
await Promise.all([settings.load(), browser.ready]);
applyTheme(settings.current, settings.mode, browser.isPrivate);

export default mount(App, { target: document.getElementById("app")! });
