// D2KIRO live capture -- pairing window. Plain script (no module): it only forwards what the Player typed to the
// background window (`pairWithCode`) and shows the short result. The code and the credential are never logged.

const siteInput = document.getElementById("site");
const codeInput = document.getElementById("code");
const connectButton = document.getElementById("connect");
const result = document.getElementById("result");

function show(message, ok) {
  result.textContent = message;
  result.className = ok ? "ok" : "bad";
}

function withBackground(use) {
  overwolf.windows.getMainWindow((main) => use(main));
}

withBackground((main) => {
  if (main && typeof main.lastSite === "function") siteInput.value = main.lastSite();
});

connectButton.addEventListener("click", () => {
  connectButton.disabled = true;
  show("Conectando...", true);
  withBackground(async (main) => {
    try {
      const outcome = await main.pairWithCode(siteInput.value, codeInput.value);
      show(outcome.message, outcome.ok);
      if (outcome.ok) codeInput.value = "";
    } catch {
      show("No se pudo conectar. Probá de nuevo.", false);
    } finally {
      connectButton.disabled = false;
    }
  });
});
