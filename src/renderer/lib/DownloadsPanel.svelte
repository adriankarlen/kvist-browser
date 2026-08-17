<script lang="ts">
  import "./DownloadsPanel.css";
  import { formatBytes } from "../../shared/bytes";
  import type { DownloadState } from "../../shared/ipc";
  import { downloads } from "./downloads.svelte";

  const MARKERS: Record<DownloadState["status"], string> = {
    progressing: ">",
    paused: "=",
    completed: "+",
    cancelled: "-",
    interrupted: "!",
  };

  // A server that sent no length leaves nothing to count towards, so the bare
  // received count is all there is to show.
  function size(entry: DownloadState): string {
    const received = formatBytes(entry.receivedBytes);
    if (entry.status === "completed") return received;
    return entry.totalBytes > 0
      ? `${received} / ${formatBytes(entry.totalBytes)}`
      : received;
  }

  function failed(entry: DownloadState): boolean {
    return entry.status === "cancelled" || entry.status === "interrupted";
  }
</script>

<!-- Scrolls an inner element rather than itself: .kv-panel's label sits outside
     its box, and any overflow but visible would clip it away. -->
<section class="kv-panel kv-downloads" data-label="downloads">
  <ul class="kv-downloads__list">
    {#each downloads.list as entry (entry.id)}
      <li
        class="kv-downloads__item"
        class:is-active={entry.status === "progressing" || entry.status === "paused"}
        class:is-done={entry.status === "completed"}
        class:is-failed={failed(entry)}
      >
        <span class="kv-downloads__marker">{MARKERS[entry.status]}</span>
        <span class="kv-downloads__name" title={entry.url}>{entry.filename}</span>
        <span class="kv-downloads__status">
          {failed(entry) ? entry.status : size(entry)}
        </span>
      </li>
    {:else}
      <li class="kv-downloads__empty">no downloads</li>
    {/each}
  </ul>
</section>
