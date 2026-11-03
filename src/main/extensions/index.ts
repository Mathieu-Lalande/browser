import type { BaseWindow } from "electron";
import type { ExtensionInfo, ExtensionInstallResult } from "@shared/extensions";
import { appServices } from "../app-services-ref";

/** Browser extensions (ADR-024): function facades over the app's `ExtensionService` (./service.ts). */

const extensions = () => appServices().extensions;

export const listExtensions = (): ExtensionInfo[] => extensions().list();
export const installFromFolder = (window: BaseWindow | null): Promise<ExtensionInstallResult> => extensions().installFromFolder(window);
export const installFromFile = (window: BaseWindow | null): Promise<ExtensionInstallResult> => extensions().installFromFile(window);
export const setExtensionEnabled = (id: string, enabled: boolean): Promise<void> => extensions().setEnabled(id, enabled);
export const setExtensionPrivateAllowed = (id: string, allowPrivate: boolean): Promise<void> => extensions().setPrivateAllowed(id, allowPrivate);
export const removeExtension = (id: string): Promise<void> => extensions().remove(id);
