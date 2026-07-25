const baseUrlInput = document.getElementById("baseUrl");
const saveButton = document.getElementById("save");
const statusEl = document.getElementById("status");

async function load() {
  baseUrlInput.value = await getBaseUrl();
}

saveButton.addEventListener("click", async () => {
  const value = baseUrlInput.value.trim();
  if (!/^https?:\/\/.+/.test(value)) {
    statusEl.textContent = "Enter a valid URL starting with http:// or https://";
    return;
  }
  await setBaseUrl(value);
  statusEl.textContent = "Saved.";
  setTimeout(() => (statusEl.textContent = ""), 2000);
});

load();
