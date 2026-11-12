module wan30.validate;

import std.algorithm : canFind, sort;
import std.array : array;
import std.conv : to;
import std.json : JSONType, JSONValue;
import std.regex : matchFirst, regex;
import std.utf : UTFException, decode;

import wan30.errors;

enum modelIds = [
    "wan30-reference-to-video",
    "wan30-text-to-video",
    "wan30-image-to-video",
];
enum resolutions = ["480p", "720p", "1080p"];
enum aspectRatios = ["16:9", "9:16", "1:1", "4:3", "3:4"];

private enum referenceKeys = [
    "prompt", "durationSeconds", "resolution", "aspectRatio", "hasAudio", "modelId", "imageUrls",
];

size_t utf16Length(string value)
{
    size_t count;
    size_t index;
    while (index < value.length)
    {
        dchar point;
        try
            point = decode(value, index);
        catch (UTFException)
            fail("The value is not valid UTF-8.");
        count += point <= 0xFFFF ? 1 : 2;
    }
    return count;
}

void fail(string message)
{
    throw new Wan30Exception("INVALID_INPUT", message);
}

string normalizeOrigin(string value)
{
    import std.ascii : isDigit;
    import std.string : indexOf;

    if (value.length < "https://x".length || value[0 .. 8] != "https://")
        throw new Wan30Exception("INVALID_ORIGIN", "Use an exact HTTPS service origin.");
    auto rest = value[8 .. $];
    if (!rest.length || rest.canFind('/') || rest.canFind('?') || rest.canFind('#')
        || rest.canFind('@') || rest.canFind(' ') || rest.canFind('\\'))
        throw new Wan30Exception("INVALID_ORIGIN", "Use an exact HTTPS service origin.");
    auto colon = rest.indexOf(':');
    if (colon == 0 || colon == rest.length - 1)
        throw new Wan30Exception("INVALID_ORIGIN", "Use an exact HTTPS service origin.");
    if (colon > 0)
    {
        auto port = rest[colon + 1 .. $];
        if (port == "443" || !port.length)
            throw new Wan30Exception("INVALID_ORIGIN", "Use an exact HTTPS service origin.");
        foreach (ch; port)
            if (!isDigit(ch))
                throw new Wan30Exception("INVALID_ORIGIN", "Use an exact HTTPS service origin.");
    }
    return value;
}

string originOf(string url)
{
    if (url.length < 8 || url[0 .. 8] != "https://")
        return null;
    try
        return normalizeOrigin(stripPath(url));
    catch (Wan30Exception)
        return null;
}

private string stripPath(string url)
{
    import std.string : indexOf;

    auto slash = url.indexOf('/', "https://".length);
    auto query = url.indexOf('?');
    auto cut = slash < 0 ? query : query < 0 ? slash : slash < query ? slash : query;
    return cut < 0 ? url : url[0 .. cut];
}

void assertDestination(string url, string origin)
{
    if (originOf(url) != origin)
        throw new Wan30Exception("INVALID_ORIGIN", "Unexpected authorization destination.");
}

private bool isBool(JSONValue value)
{
    return value.type == JSONType.true_ || value.type == JSONType.false_;
}

private void requireInteger(JSONValue value, string label, long low, long high)
{
    if (value.type != JSONType.integer || value.integer < low || value.integer > high)
        fail(label ~ " must be an integer from " ~ low.to!string ~ " to " ~ high.to!string ~ ".");
}

void validateGeneration(JSONValue value)
{
    if (value.type != JSONType.object)
        fail("Generation input must be an object.");
    string modelId = "wan30-reference-to-video";
    if ("modelId" in value)
    {
        if (value["modelId"].type != JSONType.string || !modelIds.canFind(value["modelId"].str))
            fail("modelId must be a supported Wan30 video model.");
        modelId = value["modelId"].str;
    }

    auto allowed = referenceKeys;
    if (modelId == "wan30-text-to-video")
    {
        if ("modelId" !in value)
            fail("modelId is required.");
        allowed = ["prompt", "durationSeconds", "resolution", "aspectRatio", "hasAudio", "modelId"];
    }
    else if (modelId == "wan30-image-to-video")
    {
        if ("modelId" !in value)
            fail("modelId is required.");
    }
    string[] extra;
    foreach (key, _; value.object)
        if (!allowed.canFind(key))
            extra ~= key;
    if (extra.length)
        fail("Unexpected generation field: " ~ extra.sort.array.join(", ") ~ ".");
    if ("prompt" !in value || value["prompt"].type != JSONType.string)
        fail("prompt must be 1 to 1500 characters.");
    auto promptLength = utf16Length(value["prompt"].str);
    if (promptLength < 1 || promptLength > 1500)
        fail("prompt must be 1 to 1500 characters.");
    if ("durationSeconds" in value)
        requireInteger(value["durationSeconds"], "durationSeconds", 2, 30);
    if ("resolution" in value && (value["resolution"].type != JSONType.string
            || !resolutions.canFind(value["resolution"].str)))
        fail("resolution must be 480p, 720p or 1080p.");
    if ("aspectRatio" in value && (value["aspectRatio"].type != JSONType.string
            || !aspectRatios.canFind(value["aspectRatio"].str)))
        fail("aspectRatio must be 16:9, 9:16, 1:1, 4:3 or 3:4.");
    if ("hasAudio" in value && !isBool(value["hasAudio"]))
        fail("hasAudio must be a boolean.");
    if (modelId == "wan30-text-to-video")
        return;
    auto low = modelId == "wan30-image-to-video" ? 1 : 1;
    auto high = modelId == "wan30-image-to-video" ? 1 : 10;
    validateImageUrls(value, low, high);
}

private void validateImageUrls(JSONValue value, int low, int high)
{
    if ("imageUrls" !in value || value["imageUrls"].type != JSONType.array
        || value["imageUrls"].array.length < low || value["imageUrls"].array.length > high)
        fail("imageUrls must contain " ~ low.to!string ~ " to " ~ high.to!string ~ " HTTPS URLs.");
    foreach (url; value["imageUrls"].array)
    {
        if (url.type != JSONType.string || !httpsUrl(url.str))
            fail("imageUrls entries must be HTTPS URLs.");
    }
}

private bool httpsUrl(string url)
{
    import std.string : indexOf;

    if (url.length < 9 || url[0 .. 8] != "https://" || url.canFind(' ') || url.canFind('\t')
        || url.canFind('\r') || url.canFind('\n'))
        return false;
    auto rest = url[8 .. $];
    auto at = rest.indexOf('@');
    if (at >= 0)
        return false;
    auto slash = rest.indexOf('/');
    auto host = slash < 0 ? rest : rest[0 .. slash];
    return host.length > 0 && host != ":" && !host.startsWith(":");
}

private bool startsWith(string value, string prefix)
{
    return value.length >= prefix.length && value[0 .. prefix.length] == prefix;
}

string validateRequestId(string requestId)
{
    auto pattern = regex(`^[A-Za-z0-9_-]{16,128}$`);
    if (matchFirst(requestId, pattern).empty)
        fail("requestId must match ^[A-Za-z0-9_-]{16,128}$.");
    return requestId;
}

string validateModelId(string modelId)
{
    if (!modelIds.canFind(modelId))
        fail("modelId must be a supported Wan30 video model.");
    return modelId;
}

string validateTaskId(string taskId)
{
    auto length = utf16Length(taskId);
    if (length < 1 || length > 128)
        fail("taskId must be 1 to 128 characters.");
    return taskId;
}

int validateLimit(int limit)
{
    if (limit < 1 || limit > 50)
        fail("limit must be an integer from 1 to 50.");
    return limit;
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
