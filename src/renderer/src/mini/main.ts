import { mount } from "svelte";
import { miniState } from "./state.svelte";
import MiniBar from "./MiniBar.svelte";
// Same theme variables as the chrome UI.
import "../styles/global.css";

document.documentElement.dataset.platform = window.platform;
// Subscribed before the first render: main sends the state once this page has loaded.
window.browser.mini.onState((state) => miniState.set(state));

export default mount(MiniBar, { target: document.getElementById("app")! });
