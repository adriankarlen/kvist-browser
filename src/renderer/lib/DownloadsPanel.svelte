<script lang="ts">
  import "./DownloadsPanel.css";
  import { formatBytes } from "../../shared/bytes";
  import type { DownloadState } from "../../shared/ipc";
  import { formatEta, formatRate, percent } from "../../shared/progress";
  import { downloads } from "./stores.svelte";

  const MARKERS: Record<DownloadState["status"], string> = {
    progressing: ">",
    paused: "=",
    completed: "+",
    cancelled: "x",
    interrupted: "!",
  };

  function moving(entry: DownloadState): boolean {
    return entry.status === "progressing" || entry.status === "paused";
  }

  function failed(entry: DownloadState): boolean {
    return entry.status === "cancelled" || entry.status === "interrupted";
  }

  /**
   * What the row counts towards. A server that sent no length leaves nothing to
   * count towards, so the bare received count is all there is to show — and a
   * finished download is its own total, so it shows one number rather than two
   * copies of the same one.
   */
  function size(entry: DownloadState): string {
    const received = formatBytes(entry.receivedBytes);
    if (!moving(entry) || entry.totalBytes <= 0) return received;
    return `${received} / ${formatBytes(entry.totalBytes)}`;
  }
</script>

<!-- Scrolls an inner element rather than itself: .kv-panel's label sits outside
     its box, and any overflow but visible would clip it away. -->
<section class="kv-panel kv-downloads" data-label="downloads">
  <ul class="kv-downloads__list">
    {#each downloads.list as entry (entry.id)}
      {@const done = percent(entry.receivedBytes, entry.totalBytes)}
      {@const eta = formatEta(entry.receivedBytes, entry.totalBytes, entry.bytesPerSecond)}
      <li
        class="kv-downloads__item"
        class:is-active={entry.status === "progressing"}
        class:is-paused={entry.status === "paused"}
        class:is-done={entry.status === "completed"}
        class:is-failed={failed(entry)}
      >
        <span class="kv-downloads__marker">{MARKERS[entry.status]}</span>
        <span class="kv-downloads__name" title={entry.url}>{entry.filename}</span>

        <!-- Only a transfer that is going anywhere gets the progress columns;
             a finished row has nothing left to say about time. -->
        {#if moving(entry) && done !== null}
          <span
            class="kv-downloads__bar"
            style="--kv-progress: {done}%"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={done}
            aria-label="{entry.filename} progress"
          ></span>
          <span class="kv-downloads__percent">{done}%</span>
        {/if}

        <span class="kv-downloads__size">{failed(entry) ? "" : size(entry)}</span>

        {#if moving(entry)}
          <span class="kv-downloads__rate">{formatRate(entry.bytesPerSecond)}</span>
          <span class="kv-downloads__eta">{entry.status === "paused" ? "paused" : eta}</span>
          <button
            class="kv-downloads__cancel"
            type="button"
            title="Cancel download"
            onclick={() => downloads.cancel(entry.id)}
          >
            x
          </button>
        {:else if failed(entry)}
          <span class="kv-downloads__status">{entry.status}</span>
        {/if}
      </li>
    {:else}
      <li class="kv-downloads__empty">no downloads</li>
    {/each}
  </ul>
</section>
