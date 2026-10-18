// Development-only client. Credentials stay in the invoking process environment.
export async function createWechatClient() {
  const token = process.env.WECHAT_MCP_TOKEN;
  const port = Number(process.env.WECHAT_MCP_PORT || 49173);
  if (!token) throw new Error('Set WECHAT_MCP_TOKEN in the current process. Do not commit it.');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid local MCP port.');
  const url = `http://127.0.0.1:${port}/mcp`;
  const headers = { 'content-type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}` };
  let nextId = 1;
  async function rpc(method, params, notification = false) {
    const id = notification ? undefined : nextId++;
    const response = await fetch(url, {
      method: 'POST', headers,
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      signal: AbortSignal.timeout(90_000),
    });
    const session = response.headers.get('mcp-session-id');
    if (session) headers['mcp-session-id'] = session;
    const body = await response.text();
    const messages = body.trimStart().startsWith('event:') || body.trimStart().startsWith('data:')
      ? body.split(/\r?\n\r?\n/).flatMap(block => {
        const data = block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        return data ? [JSON.parse(data)] : [];
      }) : body ? [JSON.parse(body)] : [];
    const message = messages.find(item => item.id === id);
    if (!response.ok || message?.error) throw new Error(`MCP ${method}: ${response.status} ${message?.error?.message || 'request failed'}`);
    if (!notification && !message) throw new Error(`MCP ${method}: missing response`);
    return message?.result;
  }
  await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'local-debug', version: '1' } });
  await rpc('notifications/initialized', {}, true);
  return {
    async listTools() { return (await rpc('tools/list', {})).tools; },
    async call(name, args) {
      const result = await rpc('tools/call', { name, arguments: args });
      let value = result.structuredContent;
      if (value === undefined) {
        const text = result.content?.filter(item => item.type === 'text').map(item => item.text).join('\n') || '';
        try { value = JSON.parse(text); } catch { value = { text }; }
      }
      if (result.isError || value?.success === false) throw new Error(`${name}: ${JSON.stringify(value)}`);
      return value;
    },
  };
}
