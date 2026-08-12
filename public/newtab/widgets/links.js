/** Bare hosts ("github.com") would resolve relative to kvist://newtab. */
function href(url) {
  return /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
}

/** Quick links, driven by [[newtab.links]] in config.toml. */
export async function initLinks() {
  const linksGrid = document.getElementById("links-grid");

  let links;
  try {
    links = (await (await fetch("config.json")).json()).links;
  } catch {
    return; // no links is not worth breaking the page over
  }

  for (const link of links) {
    if (!link.name.trim()) continue;
    const a = document.createElement("a");
    a.href = href(link.url);
    a.className = "link-item";
    a.textContent = `> ${link.name}`;
    linksGrid.appendChild(a);
  }
}
