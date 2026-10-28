import type { CommandIcon } from "@shared/commands";
import type { SpaceIcon } from "@shared/spaces";
import type { LucideIcon } from "lucide-react-native";
// Lucide icons (https://lucide.dev), imported one by one so the bundle only holds the ones used.
import ArrowUpLeft from "lucide-react-native/icons/arrow-up-left";
import BookOpen from "lucide-react-native/icons/book-open";
import Briefcase from "lucide-react-native/icons/briefcase";
import Calendar from "lucide-react-native/icons/calendar";
import Camera from "lucide-react-native/icons/camera";
import Check from "lucide-react-native/icons/check";
import ChefHat from "lucide-react-native/icons/chef-hat";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import CircleUser from "lucide-react-native/icons/circle-user";
import Clock from "lucide-react-native/icons/clock";
import CodeXml from "lucide-react-native/icons/code-xml";
import Coffee from "lucide-react-native/icons/coffee";
import Command from "lucide-react-native/icons/command";
import Copy from "lucide-react-native/icons/copy";
import Dumbbell from "lucide-react-native/icons/dumbbell";
import Ellipsis from "lucide-react-native/icons/ellipsis";
import ExternalLink from "lucide-react-native/icons/external-link";
import Film from "lucide-react-native/icons/film";
import FlaskConical from "lucide-react-native/icons/flask-conical";
import Folder from "lucide-react-native/icons/folder";
import Gamepad2 from "lucide-react-native/icons/gamepad-2";
import Globe from "lucide-react-native/icons/globe";
import GraduationCap from "lucide-react-native/icons/graduation-cap";
import Heart from "lucide-react-native/icons/heart";
import House from "lucide-react-native/icons/house";
import Info from "lucide-react-native/icons/info";
import Landmark from "lucide-react-native/icons/landmark";
import Layers from "lucide-react-native/icons/layers";
import Lightbulb from "lucide-react-native/icons/lightbulb";
import Link from "lucide-react-native/icons/link";
import Lock from "lucide-react-native/icons/lock";
import LockOpen from "lucide-react-native/icons/lock-open";
import Mail from "lucide-react-native/icons/mail";
import Music from "lucide-react-native/icons/music";
import Newspaper from "lucide-react-native/icons/newspaper";
import Palette from "lucide-react-native/icons/palette";
import Pencil from "lucide-react-native/icons/pencil";
import Pin from "lucide-react-native/icons/pin";
import Plane from "lucide-react-native/icons/plane";
import Plus from "lucide-react-native/icons/plus";
import Rocket from "lucide-react-native/icons/rocket";
import RotateCw from "lucide-react-native/icons/rotate-cw";
import Search from "lucide-react-native/icons/search";
import Share from "lucide-react-native/icons/share";
import Shield from "lucide-react-native/icons/shield";
import ShoppingBag from "lucide-react-native/icons/shopping-bag";
import SlidersHorizontal from "lucide-react-native/icons/sliders-horizontal";
import Sparkles from "lucide-react-native/icons/sparkles";
import Sprout from "lucide-react-native/icons/sprout";
import Star from "lucide-react-native/icons/star";
import Trash from "lucide-react-native/icons/trash";
import Users from "lucide-react-native/icons/users";
import VenetianMask from "lucide-react-native/icons/venetian-mask";
import Wallet from "lucide-react-native/icons/wallet";
import X from "lucide-react-native/icons/x";
import Zap from "lucide-react-native/icons/zap";
import { memo } from "react";

/** The app's own icon names, mapped to Lucide icons (call sites never import Lucide directly). */
import Cloud from "lucide-react-native/icons/cloud";
import CloudOff from "lucide-react-native/icons/cloud-off";
import Laptop from "lucide-react-native/icons/laptop";
import Smartphone from "lucide-react-native/icons/smartphone";
import QrCode from "lucide-react-native/icons/qr-code";
import Unlink from "lucide-react-native/icons/unlink";
import KeyRound from "lucide-react-native/icons/key-round";
import Ban from "lucide-react-native/icons/ban";
import Eye from "lucide-react-native/icons/eye";
import EyeOff from "lucide-react-native/icons/eye-off";
import ScanLine from "lucide-react-native/icons/scan-line";
import Archive from "lucide-react-native/icons/archive";
import ArchiveRestore from "lucide-react-native/icons/archive-restore";
import FolderInput from "lucide-react-native/icons/folder-input";
import FolderPlus from "lucide-react-native/icons/folder-plus";
import LayoutGrid from "lucide-react-native/icons/layout-grid";
import Type from "lucide-react-native/icons/type";

const ui = {
  search: Search,
  plus: Plus,
  close: X,
  back: ChevronLeft,
  forward: ChevronRight,
  share: Share,
  tabs: Copy,
  more: Ellipsis,
  reload: RotateCw,
  star: Star,
  pin: Pin,
  copy: Copy,
  link: Link,
  settings: SlidersHorizontal,
  trash: Trash,
  mask: VenetianMask,
  layers: Layers,
  lock: Lock,
  unlock: LockOpen,
  globe: Globe,
  check: Check,
  clock: Clock,
  fill: ArrowUpLeft,
  shield: Shield,
  home: House,
  open: ExternalLink,
  command: Command,
  edit: Pencil,
  info: Info,
  sparkles: Sparkles,
  chevronDown: ChevronDown,
  // Sync (ADR-019).
  cloud: Cloud,
  cloudOff: CloudOff,
  laptop: Laptop,
  smartphone: Smartphone,
  qr: QrCode,
  scan: ScanLine,
  unlink: Unlink,
  key: KeyRound,
  // Organisation (ADR-022).
  archive: Archive,
  archiveRestore: ArchiveRestore,
  folderInput: FolderInput,
  folderPlus: FolderPlus,
  favorite: LayoutGrid,
  // Passwords (ADR-025).
  ban: Ban,
  eye: Eye,
  eyeOff: EyeOff,
  // Reader mode (ADR-026).
  reader: BookOpen,
  textSize: Type,
} satisfies Record<string, LucideIcon>;

/** Space icons: their stored names (src/shared/spaces.ts) are Lucide's own. */
const spaces = {
  "circle-user": CircleUser,
  briefcase: Briefcase,
  palette: Palette,
  "book-open": BookOpen,
  "gamepad-2": Gamepad2,
  "shopping-bag": ShoppingBag,
  plane: Plane,
  music: Music,
  lightbulb: Lightbulb,
  "flask-conical": FlaskConical,
  sprout: Sprout,
  star: Star,
  lock: Lock,
  newspaper: Newspaper,
  "chef-hat": ChefHat,
  heart: Heart,
  code: CodeXml,
  "graduation-cap": GraduationCap,
  dumbbell: Dumbbell,
  camera: Camera,
  film: Film,
  globe: Globe,
  rocket: Rocket,
  landmark: Landmark,
  wallet: Wallet,
  calendar: Calendar,
  mail: Mail,
  folder: Folder,
  layers: Layers,
  zap: Zap,
  coffee: Coffee,
  users: Users,
  "venetian-mask": VenetianMask,
} satisfies Record<SpaceIcon, LucideIcon>;

const icons: Record<string, LucideIcon> = { ...ui, ...spaces };

export type IconName = keyof typeof ui | SpaceIcon;

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
  info: "info",
  favorite: "favorite",
  folder: "folder",
  archive: "archive",
};

interface Props {
  name: IconName;
  size?: number;
  /** Always a theme color (React Native has no `currentColor` inheritance). */
  color: string;
  strokeWidth?: number;
  filled?: boolean;
}

export const Icon = memo(function Icon({ name, size = 24, color, strokeWidth = 1.75, filled = false }: Props) {
  const Glyph = icons[name] ?? Star;
  return <Glyph size={size} color={color} strokeWidth={strokeWidth} fill={filled ? color : "none"} />;
});
