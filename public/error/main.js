// Renders the failure the URL carries. The page is a dead end by design —
// no IPC, no preload privileges — so everything it needs is in the query.
const params = new URLSearchParams(location.search);

const code = params.get("code");
const description = params.get("desc") ?? "";
const url = params.get("url") ?? "";

if (url === "") {
  // Landed here without a target — nothing meaningful to show or retry.
  document.getElementById("retry").remove();
} else {
  document.getElementById("url").textContent = url;
  const retry = document.getElementById("retry");
  retry.href = url;
}

const headline = params.get("headline");
if (headline !== null && headline !== "") {
  document.getElementById("headline").textContent = headline;
}

document.getElementById("code").textContent =
  code === null ? "render process gone" : `error ${code}`;
document.getElementById("description").textContent = description;
document.title = `Failed to load ${url}`;
