function startTemplateDialogue() {
  appendMessage("こんにちは、体調はいかがですか？", "caregiver");
  appendMessage("はい、まあまあです。", "caree");
}

function appendMessage(text, role) {
  const container = document.getElementById("chat-container");
  const div = document.createElement("div");
  div.classList.add("message");
  if (role === "caregiver") {
    div.classList.add("caregiver");
  } else if (role === "caree") {
    div.classList.add("caree");
  }
  div.textContent = text;
  container.appendChild(div);
}
