/** Executable-contract fixtures used both in generation guidance and local tests. */
export const INTELLIGENT_UI_CHECKLIST_EXAMPLE = {
  version: 1,
  kind: "checklist",
  title: "Trip preparation",
  summary: "Check the items you have packed.",
  props: {
    items: [
      { id: "passport", label: "Passport" },
      { id: "charger", label: "Charger" },
    ],
  },
} as const;

export const INTELLIGENT_UI_FORM_HTML = `<form id="portions-form">
  <label for="portions">Portions</label>
  <input id="portions" name="portions" type="number" min="1" max="20" step="1" value="2" required>
  <button type="submit">Calculate</button>
  <button type="reset">Reset</button>
  <output id="result" aria-live="polite"></output>
  <button id="ask-ai" type="button" data-neo-ai-action>Ask AI to explain this result</button>
  <p id="send-status" role="status"></p>
</form>
<script>
const form = document.getElementById("portions-form");
const input = document.getElementById("portions");
const output = document.getElementById("result");
const saved = window.intelligentUi.initialState;
if (typeof saved.portions === "string") input.value = saved.portions;
if (typeof saved.result === "string") output.textContent = saved.result;
function save() {
  window.intelligentUi.setState({ portions: input.value, result: output.textContent });
  const summary = "Portions: " + input.value + ". " + output.textContent;
  window.intelligentUi.reportSummary(summary);
  window.intelligentUi.reportSnapshot(summary);
}
input.addEventListener("input", () => { output.textContent = ""; save(); });
form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  output.textContent = "Rice: " + input.valueAsNumber * 75 + " g";
  save();
});
const ask = document.getElementById("ask-ai");
const status = document.getElementById("send-status");
ask.addEventListener("click", () => {
  if (!form.reportValidity()) return;
  save();
  const accepted = window.intelligentUi.sendMessage("Explain the current portion calculation and suggest how to adjust it.");
  ask.disabled = true;
  status.textContent = "Review and send the draft in the message input...";
  accepted.then((result) => {
    status.textContent = result.ok ? "Sent. The reply will appear in chat." : result.code === "cancelled" ? "Cancelled. Nothing was sent." : "Unable to send (" + result.code + "). Please try again.";
  }).catch(() => { status.textContent = "Unable to send. Please try again."; })
    .finally(() => { ask.disabled = false; });
});
form.addEventListener("reset", () => queueMicrotask(() => {
  output.textContent = "";
  save();
}));
</script>`;

export const INTELLIGENT_UI_FORM_EXAMPLE = {
  version: 1,
  title: "Portion calculator",
  summary: "An illustrative recipe uses 75 g of rice per portion.",
  html: INTELLIGENT_UI_FORM_HTML,
} as const;

export function formatHtmlPromptExample(): string {
  const { html, ...metadata } = INTELLIGENT_UI_FORM_EXAMPLE;
  return `\`\`\`intelligent-ui\n${JSON.stringify(metadata)}\n${html}\n\`\`\``;
}
