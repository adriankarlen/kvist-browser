/**
 * Main resolves the text, as it does for the omnibox, so an address opens
 * and anything else searches with the configured engine.
 */
export function initSearch() {
  const form = document.getElementById("start-search");
  const input = document.getElementById("start-query");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
      const { url } = await (await fetch(`resolve?q=${encodeURIComponent(input.value)}`)).json();

      if (url) location.href = url;
    } catch {
      // Nothing to open is not worth an error on the start page.
    }
  });
}
