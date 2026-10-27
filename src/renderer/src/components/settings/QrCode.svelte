<script lang="ts">
  import { encode } from "uqr";

  /** A QR code drawn locally as SVG (uqr, pure JS: nothing leaves the machine to render it). */
  let { value, size = 200, label }: { value: string; size?: number; label: string } = $props();

  const qr = $derived(encode(value, { ecc: "M", border: 2 }));
  const path = $derived(
    qr.data
      .flatMap((row, y) => row.map((dark, x) => (dark ? `M${x} ${y}h1v1h-1z` : "")))
      .join(""),
  );
</script>

<svg class="qr" width={size} height={size} viewBox="0 0 {qr.size} {qr.size}" role="img" aria-label={label} shape-rendering="crispEdges">
  <rect width={qr.size} height={qr.size} fill="#fff" />
  <path d={path} fill="#000" />
</svg>

<style>
  .qr {
    display: block;
    border-radius: 10px;
  }
</style>
