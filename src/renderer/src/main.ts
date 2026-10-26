import { mount } from "svelte";
import App from "./App.svelte";
import { settings } from "./lib/settings.svelte";
import { applyTheme } from "./lib/theme";
import "./styles/global.css";

document.documentElement.dataset.platform = window.platform;

// The saved theme is applied before the first render: no flash of the default colors.
await settings.load();
applyTheme(settings.current, settings.mode);

export default mount(App, { target: document.getElementById("app")! });
