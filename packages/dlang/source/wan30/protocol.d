module wan30.protocol;

import std.algorithm : canFind, startsWith;
import std.conv : to;
import std.json : JSONType, JSONValue, parseJSON;
import std.string : strip, toLower;

import wan30.errors;
import wan30.validate : assertDestination;

enum latestProtocolVersion = "2025-11-25";
enum supportedProtocolVersions = [
    latestProtocolVersion, "2025-06-18", "2025-03-26", "2024-11-05", "2024-10-07",
];
enum clientInfoName = "wan30-d";
enum initializeTimeout = 60;
enum toolTimeout = 300;
enum responseLimit = 2_097_152;
enum authResponseLimit = 65_536;

struct RawResponse
{
    int status;
    string[string] headers;
    ubyte[] body;
}

alias Exchange = RawResponse delegate(string method, string url, string[string] headers,
        const(ubyte)[] body, int timeoutSeconds, int maxBytes);

struct McpSession
{
    string origin;
    string delegate() getToken;
    Exchange exchange;
    string clientVersion;
    string endpoint;
    string sessionId;
    string protocolVersion;
    long nextId;
    bool ready;

    this(string origin, string delegate() getToken, Exchange exchange, string clientVersion)
    {
        this.origin = origin;
        this.getToken = getToken;
        this.exchange = exchange;
        this.clientVersion = clientVersion;
        endpoint = origin ~ "/api/mcp/";
    }

    void close()
    {
        reset();
    }

    JSONValue callTool(string name, JSONValue arguments, int timeout = toolTimeout)
    {
        ensure();
        auto params = parseJSON("{}");
        params["name"] = name;
        params["arguments"] = arguments;
        return request("tools/call", params, timeout);
    }

    private void reset()
    {
        sessionId = null;
        protocolVersion = null;
        nextId = 0;
        ready = false;
    }

    private void ensure()
    {
        if (ready)
            return;
        try
        {
            auto params = parseJSON("{}");
            params["protocolVersion"] = latestProtocolVersion;
            params["capabilities"] = parseJSON("{}");
            auto info = parseJSON("{}");
            info["name"] = clientInfoName;
            info["version"] = clientVersion;
            params["clientInfo"] = info;
            auto result = request("initialize", params, initializeTimeout);
            string serverVersion;
            if (result.type == JSONType.object && "protocolVersion" in result
                    && result["protocolVersion"].type == JSONType.string)
                serverVersion = result["protocolVersion"].str;
            if (!supportedProtocolVersions.canFind(serverVersion))
                throw new Wan30Exception("PROTOCOL_ERROR",
                        "Server's protocol version is not supported: " ~ serverVersion);
            protocolVersion = serverVersion;
            notify("notifications/initialized", initializeTimeout);
            ready = true;
        }
        catch (Exception error)
        {
            reset();
            throw error;
        }
    }

    private JSONValue request(string method, JSONValue params, int timeout)
    {
        auto id = nextId++;
        auto payload = parseJSON("{}");
        payload["method"] = method;
        payload["params"] = params;
        payload["jsonrpc"] = "2.0";
        payload["id"] = id;
        auto response = post(payload, timeout);
        if (response.status == 202 || response.status < 200 || response.status >= 300)
            throw new Wan30Exception("INVALID_RESPONSE",
                    "The server returned HTTP " ~ response.status.to!string ~ ".", response.status);
        auto message = matching(rpcMessages(response), id);
        if ("error" in message)
            raiseRpc(message);
        if ("result" !in message || message["result"].type != JSONType.object)
            throw new Wan30Exception("INVALID_RESPONSE", "The server returned an unreadable response.");
        return message["result"];
    }

    private void notify(string method, int timeout)
    {
        auto payload = parseJSON("{}");
        payload["method"] = method;
        payload["jsonrpc"] = "2.0";
        auto response = post(payload, timeout);
        if (response.status != 200 && response.status != 202 && response.status != 204)
            throw new Wan30Exception("INVALID_RESPONSE",
                    "The server returned HTTP " ~ response.status.to!string ~ ".", response.status);
    }

    private RawResponse post(JSONValue payload, int timeout)
    {
        auto token = getToken();
        if (!token.length)
            throw new Wan30Exception("INVALID_TOKEN",
                    "Access token is not a Wan30 API authorization. Sign in again.");
        assertDestination(endpoint, origin);
        string[string] headers;
        headers["Authorization"] = "Bearer " ~ token;
        headers["Content-Type"] = "application/json";
        headers["Accept"] = "application/json, text/event-stream";
        if (sessionId.length)
            headers["mcp-session-id"] = sessionId;
        if (protocolVersion.length)
            headers["mcp-protocol-version"] = protocolVersion;
        RawResponse response;
        try
            response = exchange("POST", endpoint, headers, cast(const(ubyte)[]) payload.toString(),
                    timeout, responseLimit);
        catch (Wan30Exception error)
            throw error;
        catch (Exception)
            throw new Wan30Exception("PROTOCOL_ERROR", "The server response was lost.");
        if (response.status == 401)
        {
            reset();
            throw new Wan30Exception("AUTH_REQUIRED", authRequiredMessage, 401);
        }
        auto session = sessionHeader(response.headers);
        if (session.length)
            sessionId = session;
        return response;
    }
}

private string sessionHeader(string[string] headers)
{
    auto raw = header(headers, "mcp-session-id");
    if (!raw.length)
        return null;
    foreach (ch; raw)
        if (ch < 0x21 || ch > 0x7E)
            throw new Wan30Exception("INVALID_RESPONSE", "The server returned an unreadable response.");
    return raw;
}

string header(string[string] headers, string name)
{
    auto lower = name.toLower;
    foreach (key, value; headers)
        if (key.toLower == lower)
            return value;
    return null;
}

string mediaType(string value)
{
    auto semi = value.indexOf(';');
    auto type = (semi < 0 ? value : value[0 .. semi]).strip.toLower;
    return type;
}

private ptrdiff_t indexOf(string value, char needle)
{
    import std.string : indexOf;

    return value.indexOf(needle);
}

JSONValue[] rpcMessages(RawResponse response)
{
    auto kind = mediaType(header(response.headers, "content-type"));
    if (kind == "text/event-stream")
        return parseSse(response.body);
    if (kind == "application/json")
    {
        JSONValue data;
        try
            data = parseJSON(cast(string) response.body);
        catch (Exception)
            throw new Wan30Exception("INVALID_RESPONSE", "The server returned an unreadable response.");
        if (data.type == JSONType.array)
        {
            JSONValue[] messages;
            foreach (item; data.array)
                messages ~= item;
            return messages;
        }
        if (data.type == JSONType.object)
            return [data];
    }
    throw new Wan30Exception("INVALID_RESPONSE", "The server returned an unreadable response.");
}

JSONValue[] parseSse(const(ubyte)[] payload)
{
    import std.utf : UTFException, validate;

    string text = cast(string) payload;
    try
        validate(text);
    catch (UTFException)
        throw new Wan30Exception("INVALID_RESPONSE", "The server returned an unreadable response.");
    text = text.replace("\r\n", "\n").replace("\r", "\n");
    JSONValue[] messages;
    string[] dataLines;
    string eventName;
    void flush()
    {
        if (dataLines.length && (!eventName.length || eventName == "message"))
        {
            try
                messages ~= parseJSON(dataLines.join("\n"));
            catch (Exception)
                throw new Wan30Exception("INVALID_RESPONSE", "The server returned an unreadable response.");
        }
        dataLines = null;
        eventName = null;
    }
    foreach (line; text.splitLines)
    {
        if (!line.length)
        {
            flush();
            continue;
        }
        if (line.startsWith(":"))
            continue;
        auto split = line.indexOf(':');
        auto field = split < 0 ? line : line[0 .. split];
        auto value = split < 0 ? "" : line[split + 1 .. $];
        if (value.startsWith(" "))
            value = value[1 .. $];
        if (field == "data")
            dataLines ~= value;
        else if (field == "event")
            eventName = value;
    }
    flush();
    return messages;
}

private string join(string[] parts, string separator)
{
    import std.array : appender;

    auto output = appender!string;
    foreach (i, part; parts)
    {
        if (i)
            output ~= separator;
        output ~= part;
    }
    return output.data;
}

private string[] splitLines(string text)
{
    import std.array : split;

    return text.split('\n');
}

private string replace(string value, string from, string to)
{
    import std.array : replace;

    return value.replace(from, to);
}

private JSONValue matching(JSONValue[] messages, long id)
{
    foreach (message; messages)
        if (message.type == JSONType.object && "id" in message
                && message["id"].type == JSONType.integer && message["id"].integer == id)
            return message;
    throw new Wan30Exception("INVALID_RESPONSE", "The server returned an unreadable response.");
}

unittest
{
    auto body = "event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"ok\":true}}\n\n";
    auto messages = parseSse(cast(ubyte[]) body);
    assert(messages.length == 1);
    assert(messages[0]["id"].integer == 1);
    assert(messages[0]["result"]["ok"].type == JSONType.true_);
}

private void raiseRpc(JSONValue message)
{
    if ("error" !in message || message["error"].type != JSONType.object)
        throw new Wan30Exception("INVALID_RESPONSE", "The server returned an unreadable response.");
    auto error = message["error"];
    long rpcCode = long.min;
    if ("code" in error && error["code"].type == JSONType.integer)
        rpcCode = error["code"].integer;
    string text = "Tool call failed.";
    if ("message" in error && error["message"].type == JSONType.string && error["message"].str.length)
        text = error["message"].str;
    if (rpcCode == 401)
        throw new Wan30Exception("AUTH_REQUIRED", authRequiredMessage, 401);
    auto failure = new Wan30Exception("PROTOCOL_ERROR", "MCP error " ~ rpcCode.to!string ~ ": " ~ text);
    failure.rpcCode = rpcCode;
    throw failure;
}
