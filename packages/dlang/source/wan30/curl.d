module wan30.curl;

import std.datetime : seconds;

import wan30.errors;
import wan30.protocol;

RawResponse curlExchange(string method, string url, string[string] headers,
        const(ubyte)[] body, int timeoutSeconds, int maxBytes)
{
    import std.net.curl : CurlException, CurlOption, HTTP;

    if (method != "POST")
        throw new Wan30Exception("PROTOCOL_ERROR", "The server response was lost.");
    auto http = HTTP(url);
    http.method = HTTP.Method.post;
    // Phobos follows up to 10 redirects unless this is uint.max, which sets
    // CURLOPT_FOLLOWLOCATION to 0. Any smaller value turns following on.
    http.maxRedirects = uint.max;
    http.operationTimeout = timeoutSeconds.seconds;
    http.connectTimeout = timeoutSeconds.seconds;
    foreach (name, value; headers)
        http.addRequestHeader(name, value);
    // A non-null buffer with size 0 is an empty POST. A null buffer makes
    // libcurl read the process stdin. The one stored byte is not sent.
    static immutable ubyte[1] emptyPost = [0];
    const(void)* fields = body.length ? body.ptr : emptyPost.ptr;
    http.handle.set(CurlOption.postfields, cast(void*) fields);
    http.handle.set(CurlOption.postfieldsize, cast(long) body.length);
    if (body.length)
        http.addRequestHeader("Content-Type", "application/json");
    else
        http.addRequestHeader("Content-Type", "");
    ubyte[] received;
    bool tooBig;
    http.onReceive = (ubyte[] data) {
        if (received.length + data.length > maxBytes)
        {
            tooBig = true;
            return 0;
        }
        received ~= data;
        return data.length;
    };
    try
        http.perform();
    catch (CurlException)
    {
        if (tooBig)
            throw new Wan30Exception("INVALID_RESPONSE", "The server response exceeded the size limit.");
        throw new Wan30Exception("PROTOCOL_ERROR", "The server response was lost.");
    }
    if (tooBig)
        throw new Wan30Exception("INVALID_RESPONSE", "The server response exceeded the size limit.");
    RawResponse response;
    response.status = http.statusLine.code;
    foreach (name, value; http.responseHeaders)
        response.headers[name.toLowerCopy] = value.idup;
    response.body = received;
    return response;
}

private string toLowerCopy(string value)
{
    import std.string : toLower;

    return value.toLower;
}
