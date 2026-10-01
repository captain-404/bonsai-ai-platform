const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createChat } = require('../lib/chat');

test('chat waits while ComfyUI owns the GPU and works again afterwards', async () => {
  const store = { state: { chats: [] }, save() {} };
  let busy = true, calls = 0;
  const chat = createChat(store, async () => { calls++; return 'hi'; }, () => busy);
  const { id } = chat.create();
  await assert.rejects(() => chat.send(id, { message: 'hello' }), e => e.status === 409 && /GPU/.test(e.message));
  assert.equal(calls, 0); assert.equal(store.state.chats[0].messages.length, 0, 'nothing is saved while refused');
  busy = false;
  assert.equal((await chat.send(id, { message: 'hello' })).messages.length, 2); assert.equal(calls, 1);
  busy = true;
  assert.equal((await chat.send(id, { message: 'again', force: true })).messages.length, 4);
});
