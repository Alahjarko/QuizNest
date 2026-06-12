import { renderChatWorkspace } from "../components/ChatPanel.js";

export async function renderChatPage(container, app) {
  await renderChatWorkspace(container, app);
}
