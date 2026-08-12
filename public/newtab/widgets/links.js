import { LINKS_KEY, loadJSON, saveJSON } from "../storage.js";

const DEFAULT_LINKS = [
  { name: "GITHUB", url: "https://github.com" },
  { name: "YOUTUBE", url: "https://youtube.com" },
];

export function initLinks() {
  const linksGrid = document.getElementById("links-grid");
  const editToggle = document.getElementById("edit-links-toggle");

  let links = loadJSON(LINKS_KEY, DEFAULT_LINKS);
  let isEditMode = false;

  const save = () => saveJSON(LINKS_KEY, links);

  function render() {
    linksGrid.innerHTML = "";
    links.forEach((link, i) => {
      if (isEditMode) {
        const wrap = document.createElement("div");
        wrap.className = "link-editor-container";

        const nameIn = document.createElement("input");
        nameIn.className = "link-edit-input";
        nameIn.value = link.name;
        nameIn.placeholder = "Name";
        nameIn.addEventListener("input", (e) => {
          links[i].name = e.target.value.toUpperCase();
          save();
        });

        const urlIn = document.createElement("input");
        urlIn.className = "link-edit-input link-edit-url";
        urlIn.value = link.url;
        urlIn.placeholder = "URL";
        urlIn.addEventListener("input", (e) => {
          links[i].url = e.target.value;
          save();
        });

        wrap.append(nameIn, urlIn);
        linksGrid.appendChild(wrap);
      } else if (link.name.trim()) {
        const a = document.createElement("a");
        a.href = link.url;
        a.className = "link-item";
        a.textContent = `> ${link.name}`;
        linksGrid.appendChild(a);
      }
    });
  }

  editToggle.addEventListener("click", () => {
    isEditMode = !isEditMode;
    editToggle.textContent = isEditMode ? "×" : "+";
    editToggle.classList.toggle("is-editing", isEditMode);
    linksGrid.classList.toggle("edit-mode", isEditMode);
    if (!isEditMode) save();
    render();
  });

  render();
}
