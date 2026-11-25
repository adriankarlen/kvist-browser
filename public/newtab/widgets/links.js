/** Bare hosts ("github.com") would resolve relative to kvist://newtab. */
function href(url) {
  return /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
}

/** A tile: the link's first letter in a rounded square, and its name. */
function tile(link) {
  const a = document.createElement("a");
  const mark = document.createElement("span");
  const name = document.createElement("span");

  a.href = href(link.url);
  a.className = "start-tile";
  mark.className = "start-tile__mark";
  mark.setAttribute("aria-hidden", "true");
  mark.textContent = link.name.trim().charAt(0).toUpperCase();
  name.className = "start-tile__name";
  name.textContent = link.name;
  a.append(mark, name);

  return a;
}

/** Quick links, driven by [[newtab.links]] in config.toml. */
export async function initLinks() {
  const linksGrid = document.getElementById("links-grid");
  const startLinks = document.getElementById("start-links");

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
    startLinks.appendChild(tile(link));
  }
}
