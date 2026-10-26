import { parentPort, workerData } from "node:worker_threads";
import { FiltersEngine } from "@ghostery/adblocker";
import { ENGINE_CONFIG } from "./blocker-config";

/**
 * Parses the downloaded filter lists off the main thread (it takes a second or two of CPU)
 * and sends back the serialized engine, which the main process deserializes in a few ms.
 */
const { lists, resources } = workerData as { lists: string[]; resources: string | null };
const engine = FiltersEngine.parse(lists.join("\n"), ENGINE_CONFIG);
if (resources) engine.updateResources(resources, String(resources.length));
parentPort?.postMessage(engine.serialize());
