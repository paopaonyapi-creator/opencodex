// Live AnythingMCP admin helpers. Used only by opt-in LIVE_ANYTHINGMCP tests and scripts.

export interface AnythingMcpLiveState {
  baseUrl: string;
  connectorId: string;
  connectorName: string;
  toolId: string;
  toolName: string;
}

async function json<T>(res: Response): Promise<T> {
  const text = await res.text();
  try { return JSON.parse(text) as T; } catch { return { raw: text } as T; }
}

export async function anythingMcpLogin(baseUrl: string, email: string, password: string, name = "Pao Live Admin"): Promise<string> {
  const base = baseUrl.replace(/\/+$/, "");
  const register = await fetch(base + "/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, name, acceptTerms: true }),
    // AnythingMCP register validator requires acceptTerms.
  });
  if (!register.ok && register.status !== 409 && register.status !== 400) {
    throw new Error("register failed HTTP " + register.status);
  }
  const login = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await json<{ accessToken?: string; message?: string }>(login);
  if (!login.ok || !body.accessToken) {
    throw new Error("login failed HTTP " + login.status);
  }
  return body.accessToken;
}

export async function provisionJsonPlaceholderConnector(input: {
  baseUrl: string;
  accessToken: string;
}): Promise<AnythingMcpLiveState> {
  const base = input.baseUrl.replace(/\/+$/, "");
  const headers = { "content-type": "application/json", authorization: "Bearer " + input.accessToken };
  const list = await fetch(base + "/api/connectors", { headers });
  const listed = await json<Array<{ id?: string; name?: string }> | { data?: Array<{ id?: string; name?: string }> }>(list);
  const connectors = Array.isArray(listed) ? listed : listed.data ?? [];
  let connector = connectors.find((c) => c.name === "jsonplaceholder-readonly");
  if (!connector?.id) {
    const created = await fetch(base + "/api/connectors", {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "jsonplaceholder-readonly",
        type: "REST",
        baseUrl: "https://jsonplaceholder.typicode.com",
        authType: "NONE",
      }),
    });
    const body = await json<{ id?: string; name?: string }>(created);
    if (!created.ok || !body.id) throw new Error("create connector failed HTTP " + created.status);
    connector = body;
  }
  const toolsRes = await fetch(base + "/api/connectors/" + connector.id + "/tools", { headers });
  const toolsBody = await json<Array<{ id?: string; name?: string }> | { data?: Array<{ id?: string; name?: string }>; tools?: Array<{ id?: string; name?: string }> }>(toolsRes);
  const tools = Array.isArray(toolsBody) ? toolsBody : toolsBody.tools ?? toolsBody.data ?? [];
  let tool = tools.find((t) => t.name === "get_post");
  if (!tool?.id) {
    const createdTool = await fetch(base + "/api/connectors/" + connector.id + "/tools", {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "get_post",
        description: "Read a public JSONPlaceholder post by id. Read-only.",
        parameters: {
          type: "object",
          properties: { id: { type: "integer", description: "Post ID" } },
          required: ["id"],
        },
        endpointMapping: { method: "GET", path: "/posts/{id}" },
      }),
    });
    const body = await json<{ id?: string; name?: string }>(createdTool);
    if (!createdTool.ok || !body.id) throw new Error("create tool failed HTTP " + createdTool.status);
    tool = body;
  }
  return {
    baseUrl: base,
    connectorId: String(connector.id),
    connectorName: String(connector.name ?? "jsonplaceholder-readonly"),
    toolId: String(tool.id),
    toolName: String(tool.name ?? "get_post"),
  };
}
