<script lang="ts" module>
  // Lucide icons (https://lucide.dev), imported one by one so the bundle only holds the ones used.
  // The names below are the UI's own (and CommandIcon's, in src/shared/commands.ts, plus the
  // space icons of src/shared/spaces.ts): call sites never import Lucide directly.
  import type { CommandIcon } from "@shared/commands";
  import type { SpaceIcon } from "@shared/spaces";
  import type { Component } from "svelte";
  import AppWindow from "@lucide/svelte/icons/app-window";
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import BookOpen from "@lucide/svelte/icons/book-open";
  import Briefcase from "@lucide/svelte/icons/briefcase";
  import Calendar from "@lucide/svelte/icons/calendar";
  import Camera from "@lucide/svelte/icons/camera";
  import Check from "@lucide/svelte/icons/check";
  import ChefHat from "@lucide/svelte/icons/chef-hat";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import ChevronUp from "@lucide/svelte/icons/chevron-up";
  import CircleUser from "@lucide/svelte/icons/circle-user";
  import Clock from "@lucide/svelte/icons/clock";
  import CodeXml from "@lucide/svelte/icons/code-xml";
  import Coffee from "@lucide/svelte/icons/coffee";
  import Columns2 from "@lucide/svelte/icons/columns-2";
  import Command from "@lucide/svelte/icons/command";
  import Copy from "@lucide/svelte/icons/copy";
  import CornerDownLeft from "@lucide/svelte/icons/corner-down-left";
  import Database from "@lucide/svelte/icons/database";
  import Download from "@lucide/svelte/icons/download";
  import Dumbbell from "@lucide/svelte/icons/dumbbell";
  import Ellipsis from "@lucide/svelte/icons/ellipsis";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import File from "@lucide/svelte/icons/file";
  import Film from "@lucide/svelte/icons/film";
  import FlaskConical from "@lucide/svelte/icons/flask-conical";
  import Folder from "@lucide/svelte/icons/folder";
  import Fullscreen from "@lucide/svelte/icons/fullscreen";
  import Gamepad2 from "@lucide/svelte/icons/gamepad-2";
  import Globe from "@lucide/svelte/icons/globe";
  import GraduationCap from "@lucide/svelte/icons/graduation-cap";
  import Heart from "@lucide/svelte/icons/heart";
  import House from "@lucide/svelte/icons/house";
  import Landmark from "@lucide/svelte/icons/landmark";
  import Layers from "@lucide/svelte/icons/layers";
  import Lightbulb from "@lucide/svelte/icons/lightbulb";
  import Link from "@lucide/svelte/icons/link";
  import Lock from "@lucide/svelte/icons/lock";
  import Mail from "@lucide/svelte/icons/mail";
  import Monitor from "@lucide/svelte/icons/monitor";
  import Moon from "@lucide/svelte/icons/moon";
  import Music from "@lucide/svelte/icons/music";
  import Newspaper from "@lucide/svelte/icons/newspaper";
  import Palette from "@lucide/svelte/icons/palette";
  import PanelLeft from "@lucide/svelte/icons/panel-left";
  import Pause from "@lucide/svelte/icons/pause";
  import PictureInPicture2 from "@lucide/svelte/icons/picture-in-picture-2";
  import Pin from "@lucide/svelte/icons/pin";
  import Plane from "@lucide/svelte/icons/plane";
  import Play from "@lucide/svelte/icons/play";
  import Plus from "@lucide/svelte/icons/plus";
  import Rocket from "@lucide/svelte/icons/rocket";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import RotateCw from "@lucide/svelte/icons/rotate-cw";
  import Scan from "@lucide/svelte/icons/scan";
  import Search from "@lucide/svelte/icons/search";
  import Settings from "@lucide/svelte/icons/settings";
  import Shield from "@lucide/svelte/icons/shield";
  import ShieldOff from "@lucide/svelte/icons/shield-off";
  import ShoppingBag from "@lucide/svelte/icons/shopping-bag";
  import SlidersVertical from "@lucide/svelte/icons/sliders-vertical";
  import Sparkle from "@lucide/svelte/icons/sparkle";
  import Sprout from "@lucide/svelte/icons/sprout";
  import Star from "@lucide/svelte/icons/star";
  import Sun from "@lucide/svelte/icons/sun";
  import Trash from "@lucide/svelte/icons/trash";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import Users from "@lucide/svelte/icons/users";
  import VenetianMask from "@lucide/svelte/icons/venetian-mask";
  import Volume2 from "@lucide/svelte/icons/volume-2";
  import VolumeX from "@lucide/svelte/icons/volume-x";
  import Wallet from "@lucide/svelte/icons/wallet";
  import X from "@lucide/svelte/icons/x";
  import Zap from "@lucide/svelte/icons/zap";
  import ZoomIn from "@lucide/svelte/icons/zoom-in";
  import ZoomOut from "@lucide/svelte/icons/zoom-out";

  import Cloud from "@lucide/svelte/icons/cloud";
  import CloudOff from "@lucide/svelte/icons/cloud-off";
  import Laptop from "@lucide/svelte/icons/laptop";
  import Smartphone from "@lucide/svelte/icons/smartphone";
  import QrCode from "@lucide/svelte/icons/qr-code";
  import Unlink from "@lucide/svelte/icons/unlink";
  import KeyRound from "@lucide/svelte/icons/key-round";

  type LucideIcon = Component<Record<string, unknown>>;

  const ui = {
    back: ArrowLeft,
    forward: ArrowRight,
    reload: RotateCw,
    stop: X,
    plus: Plus,
    close: X,
    pin: Pin,
    split: Columns2,
    more: Ellipsis,
    layers: Layers,
    sidebar: PanelLeft,
    search: Search,
    lock: Lock,
    globe: Globe,
    warning: TriangleAlert,
    sparkle: Sparkle,
    star: Star,
    clock: Clock,
    shield: Shield,
    "shield-off": ShieldOff,
    window: AppWindow,
    duplicate: Copy,
    copy: Link,
    "zoom-in": ZoomIn,
    "zoom-out": ZoomOut,
    "zoom-reset": Scan,
    code: CodeXml,
    trash: Trash,
    command: Command,
    enter: CornerDownLeft,
    arrow: ArrowRight,
    settings: Settings,
    sun: Sun,
    moon: Moon,
    monitor: Monitor,
    palette: Palette,
    home: House,
    sliders: SlidersVertical,
    database: Database,
    check: Check,
    reset: RotateCcw,
    zen: Fullscreen,
    mask: VenetianMask,
    download: Download,
    volume: Volume2,
    "volume-off": VolumeX,
    pip: PictureInPicture2,
    folder: Folder,
    file: File,
    open: ExternalLink,
    pause: Pause,
    play: Play,
    "chevron-up": ChevronUp,
    "chevron-down": ChevronDown,
    // Sync (ADR-019).
    cloud: Cloud,
    "cloud-off": CloudOff,
    laptop: Laptop,
    smartphone: Smartphone,
    qr: QrCode,
    unlink: Unlink,
    key: KeyRound,
  } satisfies Record<string, LucideIcon> & Record<CommandIcon, LucideIcon>;

  /** Space icons: their stored names are Lucide's own. */
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
</script>

<script lang="ts">
  let {
    name,
    size = 16,
    filled = false,
    strokeWidth = 2,
  }: { name: IconName; size?: number; filled?: boolean; strokeWidth?: number } = $props();

  const Glyph = $derived(icons[name] ?? icons.star);
</script>

<!-- Color comes from CSS (`currentColor`); never set one here. -->
<Glyph {size} {strokeWidth} fill={filled ? "currentColor" : "none"} />
