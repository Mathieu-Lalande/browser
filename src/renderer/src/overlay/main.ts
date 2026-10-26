import { mount } from "svelte";
import Overlay from "./Overlay.svelte";
// Same theme variables as the chrome UI, so floating UI follows the theme.
import "../styles/global.css";

document.documentElement.dataset.platform = window.platform;

export default mount(Overlay, { target: document.getElementById("app")! });
