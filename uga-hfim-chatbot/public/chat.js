const messagesDiv = document.getElementById('messages');
const input = document.getElementById('userInput');
const btn = document.getElementById('sendBtn');

btn.addEventListener('click', sendMessage);
input.addEventListener('keydown', e => {
  if (e.key === 'Enter') sendMessage();
});

function appendMessage(text, cls) {
  const div = document.createElement('div');
  div.className = `msg ${cls}`;
  div.textContent = text;
  messagesDiv.appendChild(div);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

async function sendMessage() {
  const text = input.value.trim();
  if (!text) return;
  appendMessage(text, 'user');
  input.value = '';

  try {
    const resp = await fetch('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    });
    const data = await resp.json();
    if (data.answer) {
      appendMessage(data.answer, 'bot');
    } else {
      appendMessage('Error: ' + (data.error || 'Unknown error'), 'bot');
    }
  } catch (e) {
    appendMessage('Network error: ' + e.message, 'bot');
  }
}
