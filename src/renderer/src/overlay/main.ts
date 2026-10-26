import { mount } from "svelte";
import { browser } from "../lib/browser.svelte";
import { settings } from "../lib/settings.svelte";
import { applyTheme } from "../lib/theme";
import Overlay from "./Overlay.svelte";
// Same theme variables as the chrome UI, so floating UI follows the theme.
import "../styles/global.css";

document.documentElement.dataset.platform = window.platform;

await Promise.all([settings.load(), browser.ready]);
applyTheme(settings.current, settings.mode, browser.isPrivate);

export default mount(Overlay, { target: document.getElementById("app")! });
