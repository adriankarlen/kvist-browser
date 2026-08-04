<script lang="ts">
  const status: string = 'phase 0 — plumbing check'
</script>

<header class="chrome">
  <span class="brand">kvist</span>
  <span class="hint">{status}</span>
</header>

<style>
  .chrome {
    display: flex;
    align-items: center;
    gap: 0.75ch;
    height: var(--kv-chrome-height);
    padding: 0 1ch;
    border-bottom: 1px solid var(--kv-border);
    -webkit-app-region: drag;
  }

  .brand {
    color: var(--kv-accent);
  }

  .hint {
    color: var(--kv-muted);
  }
</style>
