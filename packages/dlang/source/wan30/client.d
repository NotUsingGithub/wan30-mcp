module wan30.client;

import std.json : JSONType, JSONValue, parseJSON;
import std.uuid : randomUUID;

import wan30.curl : curlExchange;
import wan30.errors;
import wan30.protocol;
import wan30.validate;

class Wan30Client
{
    string origin;
    private string token;
    private McpSession session;

    this(string token, string origin = "https://wan30.video", Exchange exchange = null)
    {
        this.origin = normalizeOrigin(origin);
        this.token = token;
        if (exchange is null)
        {
            import std.functional : toDelegate;

            exchange = toDelegate(&curlExchange);
        }
        session = McpSession(this.origin, &readToken, exchange, "0.1.0");
    }

    static Wan30Client fromEnvironment()
    {
        import std.process : environment;

        auto token = environment.get("WAN30_ACCESS_TOKEN", "");
        auto origin = environment.get("WAN30_ORIGIN", "https://wan30.video");
        if (!token.length)
            throw new Wan30Exception("INVALID_TOKEN",
                    "Access token is not a Wan30 API authorization. Sign in again.");
        return new Wan30Client(token, origin);
    }

    JSONValue account()
    {
        return call("account_status", parseJSON("{}"));
    }

    JSONValue models()
    {
        return call("list_models", parseJSON("{}"));
    }

    JSONValue model(string modelId)
    {
        validateModelId(modelId);
        auto arguments = parseJSON("{}");
        arguments["modelId"] = modelId;
        return call("get_model", arguments);
    }

    JSONValue estimate(JSONValue input)
    {
        validateGeneration(input);
        auto arguments = parseJSON("{}");
        arguments["input"] = input;
        return call("estimate_generation", arguments);
    }

    JSONValue generate(JSONValue input, string requestId = null, bool confirmSpend = false)
    {
        validateGeneration(input);
        if (requestId.length)
            validateRequestId(requestId);
        if (!confirmSpend)
            throw new Wan30Exception("SPEND_NOT_CONFIRMED", spendNotConfirmed);
        if (!requestId.length)
            requestId = randomUUID().toString();
        auto arguments = parseJSON("{}");
        arguments["input"] = input;
        arguments["requestId"] = requestId;
        return call("generate_video", arguments);
    }

    JSONValue tasks()
    {
        return call("list_tasks", parseJSON("{}"));
    }

    JSONValue tasks(int limit)
    {
        validateLimit(limit);
        auto arguments = parseJSON("{}");
        arguments["limit"] = limit;
        return call("list_tasks", arguments);
    }

    JSONValue task(string taskId)
    {
        validateTaskId(taskId);
        auto arguments = parseJSON("{}");
        arguments["taskId"] = taskId;
        return call("get_task", arguments);
    }

    void close()
    {
        session.close();
    }

    void disconnect()
    {
        auto url = origin ~ "/api/mcp/disconnect/";
        assertDestination(url, origin);
        auto token = session.getToken();
        if (!token.length)
            throw new Wan30Exception("INVALID_TOKEN",
                    "Access token is not a Wan30 API authorization. Sign in again.");
        string[string] headers;
        headers["Authorization"] = "Bearer " ~ token;
        RawResponse response;
        try
            response = session.exchange("POST", url, headers, null, initializeTimeout, authResponseLimit);
        catch (Wan30Exception error)
            throw error;
        catch (Exception)
            throw new Wan30Exception("REVOCATION_UNCONFIRMED", "Could not disconnect.");
        if (response.status < 200 || response.status >= 300)
            throw new Wan30Exception("REVOCATION_UNCONFIRMED", "Could not disconnect.", response.status);
    }

    private string readToken()
    {
        return token;
    }

    private JSONValue call(string name, JSONValue arguments)
    {
        auto result = session.callTool(name, arguments);
        if ("isError" in result && result["isError"].type == JSONType.true_)
            throw toolError(result);
        if ("structuredContent" !in result || result["structuredContent"].type != JSONType.object
                || "data" !in result["structuredContent"])
            throw new Wan30Exception("INVALID_RESPONSE", "The server returned an unreadable response.");
        return result["structuredContent"]["data"];
    }
}

private Wan30Exception toolError(JSONValue result)
{
    string text;
    if ("content" in result && result["content"].type == JSONType.array && result["content"].array.length)
    {
        auto first = result["content"].array[0];
        if (first.type == JSONType.object && "text" in first && first["text"].type == JSONType.string)
            text = first["text"].str;
    }
    auto code = "TOOL_ERROR";
    auto message = text.length ? text : "Tool call failed.";
    try
    {
        auto parsed = parseJSON(text);
        if (parsed.type == JSONType.object)
        {
            if ("code" in parsed && parsed["code"].type == JSONType.string && parsed["code"].str.length)
                code = parsed["code"].str;
            if ("message" in parsed && parsed["message"].type == JSONType.string
                    && parsed["message"].str.length)
                message = parsed["message"].str;
        }
    }
    catch (Exception)
    {
    }
    return new Wan30Exception(code, message);
}

unittest
{
    RawResponse[] seen;
    JSONValue[] bodies;
    string[string][] headers;
    RawResponse[] script;
    script ~= ok(0, `{"protocolVersion":"2025-11-25","capabilities":{}}`, "session-a");
    script ~= RawResponse(202);
    script ~= tool(1, `{"credits":3}`, "session-a");
    script ~= tool(2, `[{"id":"wan30-text-to-video"}]`, "session-a");
    auto client = scripted(script, seen, bodies, headers);
    auto account = client.account();
    assert(account["credits"].integer == 3);
    assert(bodies.length == 3);
    assert(bodies[0]["method"].str == "initialize");
    assert(bodies[0]["id"].integer == 0);
    assert(bodies[0]["params"]["clientInfo"]["name"].str == "wan30-d");
    assert("mcp-session-id" !in headers[0]);
    assert(bodies[1]["method"].str == "notifications/initialized");
    assert("id" !in bodies[1]);
    assert(headers[1]["mcp-session-id"] == "session-a");
    assert(headers[1]["mcp-protocol-version"] == "2025-11-25");
    assert(bodies[2]["method"].str == "tools/call");
    assert(bodies[2]["params"]["name"].str == "account_status");
    assert(bodies[2]["params"]["arguments"].object.length == 0);
    client.models();
    assert(bodies.length == 4);
    assert(bodies[3]["params"]["name"].str == "list_models");
    assert(bodies[3]["id"].integer == 2);
}

unittest
{
    RawResponse[] seen;
    JSONValue[] bodies;
    string[string][] headers;
    RawResponse[] script;
    script ~= ok(0, `{"protocolVersion":"2025-11-25","capabilities":{}}`, "session-a");
    script ~= RawResponse(202);
    script ~= tool(1, `{"quoted":true}`, "session-a");
    auto client = scripted(script, seen, bodies, headers);
    auto input = parseJSON(`{"modelId":"wan30-text-to-video","prompt":"A paper boat"}`);
    auto quote = client.estimate(input);
    assert(quote["quoted"].type == JSONType.true_);
    auto sent = bodies[$ - 1]["params"]["arguments"]["input"];
    assert(sent["modelId"].str == "wan30-text-to-video");
    assert("durationSeconds" !in sent);
    assert("resolution" !in sent);
    assert("confirmSpend" !in bodies[$ - 1]["params"]["arguments"]);
}

unittest
{
    RawResponse[] seen;
    JSONValue[] bodies;
    string[string][] headers;
    auto client = scripted(null, seen, bodies, headers);
    auto input = parseJSON(`{"modelId":"wan30-text-to-video","prompt":"A paper boat"}`);
    auto blocked = false;
    try
        client.generate(input, "paper-boat-request");
    catch (Wan30Exception error)
    {
        blocked = error.code == "SPEND_NOT_CONFIRMED";
        assert(error.msg.canFind("purchased wan30.video credits"));
        assert(error.msg.canFind("check-in"));
    }
    assert(blocked);
    assert(bodies.length == 0);
}

unittest
{
    RawResponse[] seen;
    JSONValue[] bodies;
    string[string][] headers;
    RawResponse[] script;
    script ~= ok(0, `{"protocolVersion":"2025-11-25","capabilities":{}}`, "session-a");
    script ~= RawResponse(202);
    script ~= tool(1, `{"taskId":"task-1"}`, "session-a");
    script ~= tool(2, `{"taskId":"task-1"}`, "session-a");
    auto client = scripted(script, seen, bodies, headers);
    auto input = parseJSON(`{"modelId":"wan30-text-to-video","prompt":"A paper boat"}`);
    auto created = client.generate(input, "paper-boat-request", true);
    assert(created["taskId"].str == "task-1");
    auto arguments = bodies[$ - 1]["params"]["arguments"];
    assert(arguments["requestId"].str == "paper-boat-request");
    assert("confirmSpend" !in arguments);
    assert("confirm_spend" !in arguments);
    client.generate(input, "paper-boat-request", true);
    assert(bodies[$ - 1]["params"]["arguments"]["requestId"].str == "paper-boat-request");
}

unittest
{
    import std.regex : matchFirst, regex;

    RawResponse[] seen;
    JSONValue[] bodies;
    string[string][] headers;
    RawResponse[] script;
    script ~= ok(0, `{"protocolVersion":"2025-11-25","capabilities":{}}`, "session-a");
    script ~= RawResponse(202);
    script ~= tool(1, `{"taskId":"task-2"}`, "session-a");
    auto client = scripted(script, seen, bodies, headers);
    auto input = parseJSON(`{"modelId":"wan30-text-to-video","prompt":"A paper boat"}`);
    auto created = client.generate(input, null, true);
    assert(created["taskId"].str == "task-2");
    auto requestId = bodies[$ - 1]["params"]["arguments"]["requestId"].str;
    assert(!matchFirst(requestId, regex(`^[A-Za-z0-9_-]{16,128}$`)).empty);
    assert("confirmSpend" !in bodies[$ - 1]["params"]["arguments"]);
}

unittest
{
    RawResponse[] seen;
    JSONValue[] bodies;
    string[string][] headers;
    RawResponse[] script;
    script ~= RawResponse(401);
    script ~= ok(0, `{"protocolVersion":"2025-11-25","capabilities":{}}`, "session-b");
    script ~= RawResponse(202);
    script ~= tool(1, `[]`, "session-b");
    auto client = scripted(script, seen, bodies, headers);
    auto denied = false;
    try
        client.tasks();
    catch (Wan30Exception error)
    {
        denied = error.code == "AUTH_REQUIRED" && error.status == 401;
    }
    assert(denied);
    auto tasks = client.tasks(20);
    assert(tasks.type == JSONType.array);
    assert(bodies[$ - 1]["id"].integer == 1);
    assert(bodies[$ - 1]["params"]["arguments"]["limit"].integer == 20);
    assert(headers[$ - 1]["mcp-session-id"] == "session-b");
}

unittest
{
    RawResponse[] seen;
    JSONValue[] bodies;
    string[string][] headers;
    RawResponse[] script;
    script ~= ok(0, `{"protocolVersion":"2025-11-25","capabilities":{}}`, "session-a");
    script ~= RawResponse(202);
    auto errorBody = `{"jsonrpc":"2.0","id":1,"result":{"isError":true,"content":[{"type":"text","text":"{\"code\":\"QUOTE_REQUIRED\",\"message\":\"Estimate first.\"}"}]}}`;
    script ~= RawResponse(200, ["content-type": "application/json", "mcp-session-id": "session-a"],
            cast(ubyte[]) errorBody);
    auto client = scripted(script, seen, bodies, headers);
    auto failed = false;
    try
        client.task("task-1");
    catch (Wan30Exception error)
    {
        failed = error.code == "QUOTE_REQUIRED" && error.msg == "Estimate first.";
    }
    assert(failed);
    assert(bodies[$ - 1]["params"]["arguments"]["taskId"].str == "task-1");
}

unittest
{
    RawResponse[] seen;
    JSONValue[] bodies;
    string[string][] headers;
    RawResponse[] script;
    script ~= ok(0, `{"protocolVersion":"2025-11-25","capabilities":{}}`, "session-a");
    script ~= RawResponse(202);
    script ~= RawResponse(202);
    auto client = scripted(script, seen, bodies, headers);
    auto rejected = false;
    try
        client.model("wan30-text-to-video");
    catch (Wan30Exception error)
        rejected = error.code == "INVALID_RESPONSE" && error.status == 202;
    assert(rejected);
}

unittest
{
    auto bad = false;
    try
        validateGeneration(parseJSON(`{"modelId":"wan30-text-to-video","prompt":"A paper boat","imageUrls":["http://cdn.example/a.png"]}`));
    catch (Wan30Exception error)
        bad = error.code == "INVALID_INPUT";
    assert(bad);
    validateModelId("wan30-image-to-video");
    validateRequestId("paper-boat-request");
}

unittest
{
    string[string][] headers;
    const(ubyte)[][] bodies;
    string[] urls;
    int[] limits;
    RawResponse[] script;
    script ~= RawResponse(401);
    script ~= RawResponse(204);
    auto cursor = new size_t;
    Exchange exchange = (string method, string url, string[string] requestHeaders, const(ubyte)[] body,
            int timeout, int maxBytes) {
        assert(method == "POST");
        assert(timeout == initializeTimeout);
        headers ~= requestHeaders.dup;
        bodies ~= body.dup;
        urls ~= url;
        limits ~= maxBytes;
        return script[(*cursor)++];
    };
    auto denied = new Wan30Client("test-token", "https://wan30.video", exchange);
    auto rejected = false;
    try
        denied.disconnect();
    catch (Wan30Exception error)
        rejected = error.code == "REVOCATION_UNCONFIRMED" && error.status == 401;
    assert(rejected);
    assert(urls[0] == "https://wan30.video/api/mcp/disconnect/");
    assert("mcp-session-id" !in headers[0]);
    assert(bodies[0].length == 0);
    assert(limits[0] == authResponseLimit);
    auto client = new Wan30Client("test-token", "https://wan30.video", exchange);
    client.disconnect();
    assert(urls[1] == "https://wan30.video/api/mcp/disconnect/");
}

unittest
{
    import std.process : environment;

    string previousToken = environment.get("WAN30_ACCESS_TOKEN", null);
    string previousOrigin = environment.get("WAN30_ORIGIN", null);
    scope (exit)
    {
        restoreEnv("WAN30_ACCESS_TOKEN", previousToken);
        restoreEnv("WAN30_ORIGIN", previousOrigin);
    }
    environment.remove("WAN30_ACCESS_TOKEN");
    auto missing = false;
    try
        Wan30Client.fromEnvironment();
    catch (Wan30Exception error)
        missing = error.code == "INVALID_TOKEN";
    assert(missing);
    environment["WAN30_ACCESS_TOKEN"] = "test-token";
    environment["WAN30_ORIGIN"] = "https://wan30.video";
    auto client = Wan30Client.fromEnvironment();
    assert(client.origin == "https://wan30.video");
}

private void restoreEnv(string name, string value)
{
    import std.process : environment;

    if (value is null)
        environment.remove(name);
    else
        environment[name] = value;
}

private bool canFind(string value, string part)
{
    import std.algorithm : canFind;

    return value.canFind(part);
}

private Wan30Client scripted(RawResponse[] script, ref RawResponse[] seen, ref JSONValue[] bodies,
        ref string[string][] headers)
{
    auto cursor = new size_t;
    auto localSeen = &seen;
    auto localBodies = &bodies;
    auto localHeaders = &headers;
    auto localScript = script;
    Exchange exchange = (string method, string url, string[string] requestHeaders, const(ubyte)[] body,
            int timeout, int maxBytes) {
        assert(method == "POST");
        assert(url == "https://wan30.video/api/mcp/");
        assert(timeout == initializeTimeout || timeout == toolTimeout);
        assert(maxBytes == responseLimit);
        (*localHeaders) ~= requestHeaders.dup;
        (*localBodies) ~= parseJSON(cast(string) body);
        assert((*cursor) < localScript.length);
        return localScript[(*cursor)++];
    };
    return new Wan30Client("test-token", "https://wan30.video", exchange);
}

private RawResponse ok(long id, string result, string sessionId)
{
    import std.conv : to;

    auto body = `{"jsonrpc":"2.0","id":` ~ id.to!string ~ `,"result":` ~ result ~ `}`;
    return RawResponse(200, ["content-type": "application/json", "mcp-session-id": sessionId],
            cast(ubyte[]) body);
}

private RawResponse tool(long id, string data, string sessionId)
{
    auto result = `{"structuredContent":{"data":` ~ data ~ `}}`;
    return ok(id, result, sessionId);
}

