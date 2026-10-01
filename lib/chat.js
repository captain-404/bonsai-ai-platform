const { randomUUID } = require('node:crypto');
const { fail, text } = require('./validation');
function createChat(store, completion = complete, gpuBusy = () => false) {
  const busy = new Set();
  return {
    create() { const chat = { id: randomUUID(), title: 'New conversation', messages: [], createdAt: new Date().toISOString() }; store.state.chats.unshift(chat); store.save(); return chat; },
    async send(id, body) {
      const chat = store.state.chats.find(c => c.id === id); if (!chat) fail('Conversation not found.', 404);
      if (busy.has(id)) fail('Wait for this conversation’s reply.', 409);
      const content = text(body.message, 'Message', 8000, true);
      // The local model and ComfyUI share one GPU: a chat reply during a generation can stall it or run out of memory.
      if (!body.force && gpuBusy()) fail('ComfyUI is generating on the GPU right now. Chat waits until it finishes so the generation is not slowed down or run out of memory. Send again when the task is done.', 409);
      busy.add(id);
      const message = { id: randomUUID(), role: 'user', content, createdAt: new Date().toISOString() };
      chat.messages.push(message); if (chat.messages.length === 1) chat.title = content.slice(0, 60);
      store.save();
      try {
        const history = []; let size = 0;
        for (const m of chat.messages.slice().reverse()) { if (m.error) continue; if (size + m.content.length > 14000) break; history.unshift({ role: m.role, content: m.content }); size += m.content.length; }
        const answer = await completion(store.state.settings, [{ role: 'system', content: 'You are Bonsai, a helpful conversational assistant. Answer normal questions clearly. This chat has no tools, filesystem access or editor control. Do not claim to perform actions. Use Agent Studio for tool tasks.' }, ...history]);
        chat.messages.push({ id: randomUUID(), role: 'assistant', content: answer, createdAt: new Date().toISOString() });
        delete chat.error; store.save(); return chat;
      } catch (e) { message.error = e.message; chat.error = e.message; store.save(); throw e; }
      finally { busy.delete(id); }
    }
  };
}
let modelQueue = Promise.resolve();
function complete(settings, messages, extra = {}, signal) {
  const pending = modelQueue.catch(() => {}).then(() => { signal?.throwIfAborted(); return requestCompletion(settings,messages,extra,signal); });
  modelQueue = pending.catch(() => {}); return pending;
}
async function requestCompletion(settings, messages, extra = {}, signal) {
  const response = await fetch(`${settings.modelUrl}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(240000)]) : AbortSignal.timeout(240000), body: JSON.stringify({ model: settings.model, messages, temperature: 0.2, max_tokens: 1400, ...extra }) });
  if (!response.ok) throw new Error(`Local model returned HTTP ${response.status}: ${(await response.text()).slice(0,300)}`);
  const result = await response.json(); const message = result.choices?.[0]?.message;
  if (extra.tools) { if (!message) throw new Error('Model returned no response.'); return message; }
  if (!message?.content?.trim()) throw new Error('Model returned no text.');
  return message.content + (result.choices[0].finish_reason === 'length' ? '\n\n[Response reached its length limit. Ask me to continue.]' : '');
}
module.exports = { createChat, complete };
