import type { CommandIcon } from "@shared/commands";
import { memo } from "react";
import Svg, { Circle, Path, Polygon, Rect } from "react-native-svg";

/** Stroke icons (Lucide-like, 24×24 grid) drawn with react-native-svg. */

const shapes = {
  search: (
    <>
      <Circle cx={11} cy={11} r={7.5} />
      <Path d="m20.5 20.5-4.2-4.2" />
    </>
  ),
  plus: <Path d="M5 12h14M12 5v14" />,
  close: <Path d="M18 6 6 18M6 6l12 12" />,
  back: <Path d="m15 18-6-6 6-6" />,
  forward: <Path d="m9 18 6-6-6-6" />,
  share: <Path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v13" />,
  tabs: (
    <>
      <Rect x={3} y={7} width={14} height={14} rx={3.5} />
      <Path d="M7.5 3H18a3 3 0 0 1 3 3v10.5" />
    </>
  ),
  more: (
    <>
      <Circle cx={5} cy={12} r={1.2} />
      <Circle cx={12} cy={12} r={1.2} />
      <Circle cx={19} cy={12} r={1.2} />
    </>
  ),
  reload: <Path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8M21 3v5h-5" />,
  star: <Polygon points="12 2.5 15 8.6 21.7 9.6 16.9 14.3 18 21 12 17.8 6 21 7.1 14.3 2.3 9.6 9 8.6" strokeLinejoin="round" />,
  pin: (
    <Path d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
  ),
  copy: (
    <>
      <Rect x={8} y={8} width={13} height={13} rx={2.5} />
      <Path d="M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2" />
    </>
  ),
  link: (
    <Path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  ),
  settings: <Path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />,
  trash: <Path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />,
  mask: (
    <Path d="M9.88 9.88a3 3 0 1 0 4.24 4.24M10.73 5.08A10.4 10.4 0 0 1 12 5c7 0 10 7 10 7a13.2 13.2 0 0 1-1.67 2.68M6.61 6.61A13.5 13.5 0 0 0 2 12s3 7 10 7a9.7 9.7 0 0 0 5.39-1.61M2 2l20 20" />
  ),
  layers: (
    <Path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83zM22 17.65l-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65M22 12.65l-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />
  ),
  lock: (
    <>
      <Rect x={4} y={11} width={16} height={10} rx={2.5} />
      <Path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
  unlock: (
    <>
      <Rect x={4} y={11} width={16} height={10} rx={2.5} />
      <Path d="M8 11V7a4 4 0 0 1 7.8-1.2" />
    </>
  ),
  globe: (
    <>
      <Circle cx={12} cy={12} r={9.5} />
      <Path d="M12 2.5a14.5 14.5 0 0 0 0 19 14.5 14.5 0 0 0 0-19M2.5 12h19" />
    </>
  ),
  check: <Path d="M20 6 9 17l-5-5" />,
  clock: (
    <>
      <Circle cx={12} cy={12} r={9.5} />
      <Path d="M12 7v5l3.5 2" />
    </>
  ),
  fill: <Path d="M7 17V7h10M17 17 7 7" />,
  shield: (
    <Path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
  ),
  home: <Path d="M3 10.5 12 3l9 7.5M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" />,
  open: <Path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6M21 3l-9 9M15 3h6v6" />,
  command: <Path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" />,
  edit: <Path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />,
  info: (
    <>
      <Circle cx={12} cy={12} r={9.5} />
      <Path d="M12 16v-4M12 8h.01" />
    </>
  ),
  sparkles: (
    <Path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.13-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.13a.5.5 0 0 1 .96 0L14.06 8.5A2 2 0 0 0 15.5 9.94l6.13 1.58a.5.5 0 0 1 0 .96L15.5 14.06a2 2 0 0 0-1.44 1.44l-1.58 6.13a.5.5 0 0 1-.96 0zM20 3v4M22 5h-4" />
  ),
  chevronDown: <Path d="m6 9 6 6 6-6" />,
  // Sync (ADR-018).
  cloud: <Path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z" />,
  cloudOff: <Path d="M2 2l20 20M5.78 5.78A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.31-.2M21.53 16.82A4.5 4.5 0 0 0 17.5 10h-1.79A7 7 0 0 0 10.21 5.2" />,
  laptop: <Path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9M2 16h20l-1.4 2.8a2 2 0 0 1-1.8 1.2H5.2a2 2 0 0 1-1.8-1.2z" />,
  smartphone: (
    <>
      <Rect x={5} y={2} width={14} height={20} rx={2.5} />
      <Path d="M12 18h.01" />
    </>
  ),
  qr: <Path d="M3 3h5v5H3zM16 3h5v5h-5zM3 16h5v5H3zM21 16h-3a2 2 0 0 0-2 2v3M21 21v.01M12 7v3a2 2 0 0 1-2 2H7M3 12h.01M12 3h.01M12 16v.01M16 12h1M21 12v.01M12 21v-1" />,
  scan: <Path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10" />,
  unlink: <Path d="M18.84 12.25l1.72-1.71a5 5 0 0 0-7.07-7.07l-1.72 1.71M5.17 11.75l-1.71 1.71a5 5 0 0 0 7.07 7.07l1.71-1.71M8 2v3M2 8h3M16 22v-3M22 16h-3" />,
  key: <Path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />,
} as const;

export type IconName = keyof typeof shapes;

/** Icons of the shared command registry, mapped to ours. */
export const COMMAND_ICONS: Partial<Record<CommandIcon, IconName>> = {
  plus: "plus",
  close: "close",
  duplicate: "copy",
  pin: "pin",
  reload: "reload",
  back: "back",
  forward: "forward",
  copy: "link",
  star: "star",
  search: "search",
  trash: "trash",
  command: "command",
  settings: "settings",
  layers: "layers",
  cloud: "cloud",
};

interface Props {
  name: IconName;
  size?: number;
  color: string;
  strokeWidth?: number;
  filled?: boolean;
}

export const Icon = memo(function Icon({ name, size = 22, color, strokeWidth = 2, filled = false }: Props) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? color : "none"}
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {shapes[name]}
    </Svg>
  );
});
