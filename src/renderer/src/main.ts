import { mount } from "svelte";
import App from "./App.svelte";
import "./styles/global.css";

document.documentElement.dataset.platform = window.platform;

export default mount(App, { target: document.getElementById("app")! });
