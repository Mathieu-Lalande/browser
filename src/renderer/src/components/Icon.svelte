<script lang="ts" module>
  // Stroke icons (24×24 grid, Lucide-style paths).
  const paths = {
    back: "M15 18l-6-6 6-6",
    forward: "M9 18l6-6-6-6",
    reload: "M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6",
    stop: "M18 6L6 18M6 6l12 12",
    plus: "M12 5v14M5 12h14",
    close: "M18 6L6 18M6 6l12 12",
    pin: "M12 17v5M9 10.76V6h6v4.76l2 3.24H7z M8 2h8",
    sidebar: "M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 3v18",
    search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35",
    lock: "M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4",
    globe: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20",
    warning: "M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
    sparkle: "M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z",
  } as const;
  export type IconName = keyof typeof paths;
</script>

<script lang="ts">
  let { name, size = 16 }: { name: IconName; size?: number } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d={paths[name]} />
</svg>
