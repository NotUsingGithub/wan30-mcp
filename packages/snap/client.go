package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	clientName            = "wan30-snap"
	clientVersion         = "0.1.0"
	protocolVersion       = "2025-11-25"
	initializeTimeout     = 60 * time.Second
	toolTimeout           = 300 * time.Second
	responseLimit         = 2_097_152
	authResponseLimit     = 65_536
	authMessage           = "Authorization expired or was revoked. Run wan30 auth login."
	unreadable            = "The server returned an unreadable response."
	lostResponse          = "The server response was lost."
	disconnectUnconfirmed = "Could not disconnect."
)

var supportedVersions = map[string]bool{
	protocolVersion: true,
	"2025-06-18":    true,
	"2025-03-26":    true,
	"2024-11-05":    true,
	"2024-10-07":    true,
}

type Error struct {
	Code    string
	Message string
	Status  int
	RPCCode any
}

func (e *Error) Error() string { return e.Message }

type Client struct {
	Origin   string
	Token    string
	HTTP     *http.Client
	session  string
	protocol string
	nextID   int
	ready    bool
}

func NewClient(origin, token string, httpClient *http.Client) (*Client, error) {
	normalized, err := NormalizeOrigin(origin)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(token) == "" {
		return nil, fail("INVALID_TOKEN", "Access token is not a Wan30 API authorization. Sign in again.", 0)
	}
	if httpClient == nil {
		httpClient = defaultHTTP()
	}
	return &Client{Origin: normalized, Token: token, HTTP: httpClient}, nil
}

func defaultHTTP() *http.Client {
	return &http.Client{CheckRedirect: refuseRedirect}
}

func refuseRedirect(req *http.Request, via []*http.Request) error {
	return http.ErrUseLastResponse
}

func (c *Client) Close() { c.reset() }

func (c *Client) reset() {
	c.session = ""
	c.protocol = ""
	c.nextID = 0
	c.ready = false
}

func (c *Client) Account() (any, error) { return c.call("account_status", map[string]any{}) }
func (c *Client) Models() (any, error)  { return c.call("list_models", map[string]any{}) }
func (c *Client) Model(modelID string) (any, error) {
	if err := ValidateModelID(modelID); err != nil {
		return nil, err
	}
	return c.call("get_model", map[string]any{"modelId": modelID})
}
func (c *Client) Estimate(input map[string]any) (any, error) {
	return c.call("estimate_generation", map[string]any{"input": input})
}
func (c *Client) Generate(input map[string]any, requestID string) (any, error) {
	return c.call("generate_video", map[string]any{"input": input, "requestId": requestID})
}
func (c *Client) Tasks(limit *int) (any, error) {
	args := map[string]any{}
	if limit != nil {
		args["limit"] = *limit
	}
	return c.call("list_tasks", args)
}
func (c *Client) Task(taskID string) (any, error) {
	if err := ValidateTaskID(taskID); err != nil {
		return nil, err
	}
	return c.call("get_task", map[string]any{"taskId": taskID})
}

func (c *Client) call(name string, arguments map[string]any) (any, error) {
	if err := c.ensure(); err != nil {
		return nil, err
	}
	result, err := c.request("tools/call", map[string]any{"name": name, "arguments": arguments}, toolTimeout)
	if err != nil {
		return nil, err
	}
	if truth, ok := result["isError"].(bool); ok && truth {
		return nil, toolError(result)
	}
	structured, ok := result["structuredContent"].(map[string]any)
	if !ok {
		return nil, fail("INVALID_RESPONSE", unreadable, 0)
	}
	data, ok := structured["data"]
	if !ok {
		return nil, fail("INVALID_RESPONSE", unreadable, 0)
	}
	return data, nil
}

func toolError(result map[string]any) *Error {
	code := "TOOL_ERROR"
	message := "Tool call failed."
	if content, ok := result["content"].([]any); ok && len(content) > 0 {
		if first, ok := content[0].(map[string]any); ok {
			if text, ok := first["text"].(string); ok && text != "" {
				message = text
				if parsed, err := decodeObject([]byte(text)); err == nil {
					if value, ok := parsed["code"].(string); ok && value != "" {
						code = value
					}
					if value, ok := parsed["message"].(string); ok && value != "" {
						message = value
					}
				}
			}
		}
	}
	return fail(code, message, 0)
}

func (c *Client) ensure() error {
	if c.ready {
		return nil
	}
	result, err := c.request("initialize", map[string]any{
		"protocolVersion": protocolVersion,
		"capabilities":    map[string]any{},
		"clientInfo":      map[string]any{"name": clientName, "version": clientVersion},
	}, initializeTimeout)
	if err != nil {
		c.reset()
		return err
	}
	version, ok := result["protocolVersion"].(string)
	if !ok || !supportedVersions[version] {
		c.reset()
		shown, _ := result["protocolVersion"].(string)
		return fail("PROTOCOL_ERROR", "Server's protocol version is not supported: "+shown, 0)
	}
	c.protocol = version
	if err := c.notify("notifications/initialized", initializeTimeout); err != nil {
		c.reset()
		return err
	}
	c.ready = true
	return nil
}

func (c *Client) request(method string, params any, timeout time.Duration) (map[string]any, error) {
	id := c.nextID
	c.nextID++
	reply, err := c.post("/api/mcp/", map[string]any{
		"jsonrpc": "2.0",
		"id":      id,
		"method":  method,
		"params":  params,
	}, timeout, responseLimit, true)
	if err != nil {
		return nil, err
	}
	if reply.status == 202 || reply.status < 200 || reply.status >= 300 {
		return nil, fail("INVALID_RESPONSE", "The server returned HTTP "+strconv.Itoa(reply.status)+".", reply.status)
	}
	messages, err := rpcMessages(reply)
	if err != nil {
		return nil, err
	}
	message, err := matching(messages, id)
	if err != nil {
		return nil, err
	}
	if _, ok := message["error"]; ok {
		return nil, raiseRPC(message)
	}
	result, ok := message["result"].(map[string]any)
	if !ok {
		return nil, fail("INVALID_RESPONSE", unreadable, 0)
	}
	return result, nil
}

func (c *Client) notify(method string, timeout time.Duration) error {
	reply, err := c.post("/api/mcp/", map[string]any{
		"jsonrpc": "2.0",
		"method":  method,
	}, timeout, responseLimit, true)
	if err != nil {
		return err
	}
	if reply.status != 200 && reply.status != 202 && reply.status != 204 {
		return fail("INVALID_RESPONSE", "The server returned HTTP "+strconv.Itoa(reply.status)+".", reply.status)
	}
	return nil
}

type httpReply struct {
	status int
	header http.Header
	body   []byte
}

func (c *Client) post(endpoint string, payload any, timeout time.Duration, limit int64, jsonBody bool) (*httpReply, error) {
	if strings.TrimSpace(c.Token) == "" {
		return nil, fail("INVALID_TOKEN", "Access token is not a Wan30 API authorization. Sign in again.", 0)
	}
	target := c.Origin + endpoint
	if got, ok := originOf(target); !ok || got != c.Origin {
		return nil, fail("INVALID_ORIGIN", "Unexpected authorization destination.", 0)
	}
	var body []byte
	if jsonBody {
		encoded, err := writeJSON(payload)
		if err != nil {
			return nil, fail("PROTOCOL_ERROR", lostResponse, 0)
		}
		body = encoded
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, target, bytes.NewReader(body))
	if err != nil {
		return nil, fail("PROTOCOL_ERROR", lostResponse, 0)
	}
	request.Header.Set("Authorization", "Bearer "+c.Token)
	if jsonBody {
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Accept", "application/json, text/event-stream")
		if c.session != "" {
			request.Header.Set("Mcp-Session-Id", c.session)
		}
		if c.protocol != "" {
			request.Header.Set("Mcp-Protocol-Version", c.protocol)
		}
	}
	response, err := c.HTTP.Do(request)
	if err != nil {
		if endpoint == "/api/mcp/disconnect/" {
			return nil, fail("REVOCATION_UNCONFIRMED", disconnectUnconfirmed, 0)
		}
		if known, ok := err.(*Error); ok {
			return nil, known
		}
		return nil, fail("PROTOCOL_ERROR", lostResponse, 0)
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusUnauthorized && endpoint == "/api/mcp/" {
		c.reset()
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 1024))
		return nil, fail("AUTH_REQUIRED", authMessage, 401)
	}
	payloadBody, err := readLimited(response.Body, limit)
	if err != nil {
		return nil, err
	}
	if endpoint == "/api/mcp/" {
		if session := response.Header.Get("Mcp-Session-Id"); session != "" {
			if !printableASCII(session) {
				return nil, fail("INVALID_RESPONSE", unreadable, 0)
			}
			c.session = session
		}
	}
	return &httpReply{status: response.StatusCode, header: response.Header.Clone(), body: payloadBody}, nil
}

func (c *Client) Disconnect() error {
	c.reset()
	reply, err := c.post("/api/mcp/disconnect/", nil, initializeTimeout, authResponseLimit, false)
	if err != nil {
		if known, ok := err.(*Error); ok && known.Code == "REVOCATION_UNCONFIRMED" {
			return known
		}
		return fail("REVOCATION_UNCONFIRMED", disconnectUnconfirmed, 0)
	}
	if reply.status < 200 || reply.status >= 300 {
		return fail("REVOCATION_UNCONFIRMED", disconnectUnconfirmed, reply.status)
	}
	return nil
}

func readLimited(reader io.Reader, limit int64) ([]byte, error) {
	body, err := io.ReadAll(io.LimitReader(reader, limit+1))
	if err != nil {
		return nil, fail("PROTOCOL_ERROR", lostResponse, 0)
	}
	if int64(len(body)) > limit {
		return nil, fail("INVALID_RESPONSE", "The server response exceeded the size limit.", 0)
	}
	return body, nil
}

func writeJSON(value any) ([]byte, error) {
	var buf bytes.Buffer
	encoder := json.NewEncoder(&buf)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		return nil, err
	}
	return bytes.TrimRight(buf.Bytes(), "\n"), nil
}

func decodeValue(payload []byte) (any, error) {
	if !utf8.Valid(payload) {
		return nil, fail("INVALID_RESPONSE", unreadable, 0)
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return nil, fail("INVALID_RESPONSE", unreadable, 0)
	}
	return value, nil
}

func decodeObject(payload []byte) (map[string]any, error) {
	value, err := decodeValue(payload)
	if err != nil {
		return nil, err
	}
	object, ok := value.(map[string]any)
	if !ok {
		return nil, fail("INVALID_RESPONSE", unreadable, 0)
	}
	return object, nil
}

func mediaType(header http.Header) string {
	value := header.Get("Content-Type")
	if i := strings.IndexByte(value, ';'); i >= 0 {
		value = value[:i]
	}
	return strings.ToLower(strings.TrimSpace(value))
}

func rpcMessages(reply *httpReply) ([]map[string]any, error) {
	switch mediaType(reply.header) {
	case "text/event-stream":
		return parseSSE(reply.body)
	case "application/json":
		value, err := decodeValue(reply.body)
		if err != nil {
			return nil, err
		}
		switch data := value.(type) {
		case []any:
			messages := make([]map[string]any, 0, len(data))
			for _, item := range data {
				object, ok := item.(map[string]any)
				if !ok {
					return nil, fail("INVALID_RESPONSE", unreadable, 0)
				}
				messages = append(messages, object)
			}
			return messages, nil
		case map[string]any:
			return []map[string]any{data}, nil
		default:
			return nil, fail("INVALID_RESPONSE", unreadable, 0)
		}
	default:
		return nil, fail("INVALID_RESPONSE", unreadable, 0)
	}
}

func parseSSE(payload []byte) ([]map[string]any, error) {
	if !utf8.Valid(payload) {
		return nil, fail("INVALID_RESPONSE", unreadable, 0)
	}
	text := strings.ReplaceAll(string(payload), "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	var messages []map[string]any
	var data []string
	event := ""
	flush := func() error {
		if len(data) > 0 && (event == "" || event == "message") {
			object, err := decodeObject([]byte(strings.Join(data, "\n")))
			if err != nil {
				return err
			}
			messages = append(messages, object)
		}
		data = nil
		event = ""
		return nil
	}
	for _, line := range strings.Split(text, "\n") {
		if line == "" {
			if err := flush(); err != nil {
				return nil, err
			}
			continue
		}
		if strings.HasPrefix(line, ":") {
			continue
		}
		field, value, found := strings.Cut(line, ":")
		if !found {
			field = line
			value = ""
		}
		value = strings.TrimPrefix(value, " ")
		switch field {
		case "data":
			data = append(data, value)
		case "event":
			event = value
		}
	}
	if err := flush(); err != nil {
		return nil, err
	}
	return messages, nil
}

func matching(messages []map[string]any, id int) (map[string]any, error) {
	for _, message := range messages {
		if sameID(message["id"], id) {
			return message, nil
		}
	}
	return nil, fail("INVALID_RESPONSE", unreadable, 0)
}

func sameID(left any, right int) bool {
	switch value := left.(type) {
	case json.Number:
		parsed, err := value.Int64()
		return err == nil && parsed == int64(right)
	case float64:
		return value == float64(right)
	case int:
		return value == right
	default:
		return false
	}
}

func raiseRPC(message map[string]any) *Error {
	object, ok := message["error"].(map[string]any)
	if !ok {
		return fail("INVALID_RESPONSE", unreadable, 0)
	}
	text, _ := object["message"].(string)
	if text == "" {
		text = "Tool call failed."
	}
	if sameID(object["code"], 401) {
		return fail("AUTH_REQUIRED", authMessage, 401)
	}
	codeText := "unknown"
	if number, ok := object["code"].(json.Number); ok {
		codeText = number.String()
	}
	return &Error{Code: "PROTOCOL_ERROR", Message: "MCP error " + codeText + ": " + text, RPCCode: object["code"]}
}

func printableASCII(value string) bool {
	if value == "" {
		return false
	}
	for i := 0; i < len(value); i++ {
		if value[i] < 0x21 || value[i] > 0x7e {
			return false
		}
	}
	return true
}
