package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"strings"
	"testing"
)

func TestNormalizeOrigin(t *testing.T) {
	got, err := NormalizeOrigin("https://wan30.video")
	if err != nil || got != "https://wan30.video" {
		t.Fatalf("origin %q %v", got, err)
	}
	if _, err := NormalizeOrigin("https://wan30.video:443"); err == nil || err.(*Error).Code != "INVALID_ORIGIN" {
		t.Fatalf("explicit 443: %v", err)
	}
}

func TestValidationRejectsUnsafeInput(t *testing.T) {
	_, err := ValidateGeneration(map[string]any{
		"prompt":    "A paper boat",
		"imageUrls": []any{"http://cdn.example/a.png"},
	})
	if err == nil || err.(*Error).Code != "INVALID_INPUT" || !strings.Contains(err.Error(), "HTTPS") {
		t.Fatalf("http image: %v", err)
	}
	_, err = ValidateGeneration(map[string]any{
		"modelId":         "wan30-text-to-video",
		"prompt":          "A paper boat",
		"durationSeconds": true,
	})
	if err == nil || err.(*Error).Code != "INVALID_INPUT" {
		t.Fatalf("logical duration: %v", err)
	}
}

func TestJSONShapes(t *testing.T) {
	empty, err := writeJSON(map[string]any{})
	if err != nil || string(empty) != "{}" {
		t.Fatalf("empty object %s %v", empty, err)
	}
	validated, err := ValidateGeneration(map[string]any{
		"prompt":    "A paper boat",
		"imageUrls": []any{"https://cdn.example/a.png"},
	})
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := writeJSON(map[string]any{"input": validated})
	if err != nil || !strings.Contains(string(encoded), `"imageUrls":["https://cdn.example/a.png"]`) || strings.Contains(string(encoded), "durationSeconds") {
		t.Fatalf("image array %s %v", encoded, err)
	}
}

func TestDefaultClientDoesNotFollowRedirect(t *testing.T) {
	hitSecond := false
	second := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hitSecond = true
		w.WriteHeader(http.StatusNoContent)
	}))
	defer second.Close()
	first := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, second.URL, http.StatusFound)
	}))
	defer first.Close()
	response, err := defaultHTTP().Post(first.URL, "application/json", strings.NewReader("{}"))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusFound || hitSecond {
		t.Fatalf("status %d followed %v", response.StatusCode, hitSecond)
	}
}

type script struct {
	t         *testing.T
	responses []*http.Response
	requests  []*http.Request
	bodies    [][]byte
}

func (s *script) RoundTrip(request *http.Request) (*http.Response, error) {
	body, err := io.ReadAll(request.Body)
	if err != nil {
		s.t.Fatal(err)
	}
	s.requests = append(s.requests, request)
	s.bodies = append(s.bodies, body)
	if len(s.requests) > len(s.responses) {
		s.t.Fatalf("unexpected request %d %s", len(s.requests), request.URL)
	}
	return s.responses[len(s.requests)-1], nil
}

func ok(id int, result, session string) *http.Response {
	header := make(http.Header)
	header.Set("Content-Type", "application/json")
	if session != "" {
		header.Set("Mcp-Session-Id", session)
	}
	body := `{"jsonrpc":"2.0","id":` + itoa(id) + `,"result":` + result + `}`
	return &http.Response{StatusCode: 200, Header: header, Body: io.NopCloser(strings.NewReader(body)), ContentLength: int64(len(body))}
}

func tool(id int, data, session string) *http.Response {
	return ok(id, `{"structuredContent":{"data":`+data+`}}`, session)
}

func accepted() *http.Response {
	return &http.Response{StatusCode: 202, Header: make(http.Header), Body: io.NopCloser(strings.NewReader("")), ContentLength: 0}
}

func itoa(value int) string {
	encoded, _ := writeJSON(value)
	return string(encoded)
}

func testClient(t *testing.T, transport *script) *Client {
	t.Helper()
	client, err := NewClient("https://wan30.video", "test-token", &http.Client{Transport: transport})
	if err != nil {
		t.Fatal(err)
	}
	return client
}

func TestHandshakeAndNoDefaultInjection(t *testing.T) {
	transport := &script{t: t, responses: []*http.Response{
		ok(0, `{"protocolVersion":"2025-11-25","capabilities":{}}`, "session-a"),
		accepted(),
		tool(1, `{"credits":3}`, "session-a"),
		tool(2, `{"quoted":true}`, "session-a"),
	}}
	client := testClient(t, transport)
	account, err := client.Account()
	if err != nil {
		t.Fatal(err)
	}
	credits, ok := account.(map[string]any)["credits"].(json.Number)
	if !ok || credits.String() != "3" {
		t.Fatalf("credits %#v", account)
	}
	if len(transport.bodies) != 3 {
		t.Fatalf("handshake calls %d", len(transport.bodies))
	}
	if !strings.Contains(string(transport.bodies[0]), `"method":"initialize"`) || !strings.Contains(string(transport.bodies[0]), `"id":0`) {
		t.Fatalf("initialize %s", transport.bodies[0])
	}
	if !strings.Contains(string(transport.bodies[0]), `"name":"wan30-snap"`) || !strings.Contains(string(transport.bodies[0]), `"version":"0.1.0"`) {
		t.Fatalf("client info %s", transport.bodies[0])
	}
	if transport.requests[0].Header.Get("Mcp-Session-Id") != "" {
		t.Fatal("session sent before the server issued one")
	}
	if !strings.Contains(string(transport.bodies[1]), `"method":"notifications/initialized"`) || strings.Contains(string(transport.bodies[1]), `"id"`) || strings.Contains(string(transport.bodies[1]), `"params"`) {
		t.Fatalf("notify %s", transport.bodies[1])
	}
	if transport.requests[1].Header.Get("Mcp-Session-Id") != "session-a" || transport.requests[1].Header.Get("Mcp-Protocol-Version") != "2025-11-25" {
		t.Fatalf("notify headers %#v", transport.requests[1].Header)
	}
	if !strings.Contains(string(transport.bodies[2]), `"name":"account_status"`) || !strings.Contains(string(transport.bodies[2]), `"arguments":{}`) {
		t.Fatalf("account %s", transport.bodies[2])
	}
	input, err := ValidateGeneration(map[string]any{
		"modelId": "wan30-text-to-video",
		"prompt":  "A paper boat",
	})
	if err != nil {
		t.Fatal(err)
	}
	quoted, err := client.Estimate(input)
	if err != nil {
		t.Fatal(err)
	}
	if quoted.(map[string]any)["quoted"] != true {
		t.Fatalf("quote %#v", quoted)
	}
	body := string(transport.bodies[3])
	if strings.Contains(body, "durationSeconds") || strings.Contains(body, "confirm") {
		t.Fatalf("estimate body %s", body)
	}
}

func TestAuthResetToolErrorAndSSE(t *testing.T) {
	denied := &http.Response{StatusCode: 401, Header: make(http.Header), Body: io.NopCloser(strings.NewReader("")), ContentLength: 0}
	transport := &script{t: t, responses: []*http.Response{
		denied,
		ok(0, `{"protocolVersion":"2025-11-25","capabilities":{}}`, "session-b"),
		accepted(),
		tool(1, `[]`, "session-b"),
	}}
	client := testClient(t, transport)
	_, err := client.Tasks(nil)
	if err == nil || err.(*Error).Code != "AUTH_REQUIRED" || err.(*Error).Status != 401 {
		t.Fatalf("auth: %v", err)
	}
	limit := 20
	tasks, err := client.Tasks(&limit)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := tasks.([]any); !ok || len(tasks.([]any)) != 0 {
		t.Fatalf("tasks %#v", tasks)
	}
	last := string(transport.bodies[len(transport.bodies)-1])
	if !strings.Contains(last, `"id":1`) || !strings.Contains(last, `"limit":20`) {
		t.Fatalf("reset call %s", last)
	}
	if transport.requests[len(transport.requests)-1].Header.Get("Mcp-Session-Id") != "session-b" {
		t.Fatal("new session was not used")
	}

	errorBody := `{"jsonrpc":"2.0","id":1,"result":{"isError":true,"content":[{"type":"text","text":"{\"code\":\"QUOTE_REQUIRED\",\"message\":\"Estimate first.\"}"}]}}`
	header := make(http.Header)
	header.Set("Content-Type", "application/json; charset=utf-8")
	header.Set("Mcp-Session-Id", "session-a")
	errored := &script{t: t, responses: []*http.Response{
		ok(0, `{"protocolVersion":"2025-11-25","capabilities":{}}`, "session-a"),
		accepted(),
		{StatusCode: 200, Header: header, Body: io.NopCloser(strings.NewReader(errorBody)), ContentLength: int64(len(errorBody))},
	}}
	quote, err := testClient(t, errored).Task("task-1")
	if quote != nil || err == nil || err.(*Error).Code != "QUOTE_REQUIRED" || err.Error() != "Estimate first." {
		t.Fatalf("tool error %#v %v", quote, err)
	}

	rejected := &script{t: t, responses: []*http.Response{
		ok(0, `{"protocolVersion":"2025-11-25","capabilities":{}}`, "session-a"),
		accepted(),
		accepted(),
	}}
	_, err = testClient(t, rejected).Model("wan30-text-to-video")
	if err == nil || err.(*Error).Code != "INVALID_RESPONSE" || err.(*Error).Status != 202 {
		t.Fatalf("202: %v", err)
	}

	sseBody := "event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"structuredContent\":{\"data\":{\"ok\":true}}}}\n\n"
	sseHeader := make(http.Header)
	sseHeader.Set("Content-Type", "text/event-stream")
	sseHeader.Set("Mcp-Session-Id", "session-a")
	sse := &script{t: t, responses: []*http.Response{
		ok(0, `{"protocolVersion":"2025-11-25","capabilities":{}}`, "session-a"),
		accepted(),
		{StatusCode: 200, Header: sseHeader, Body: io.NopCloser(strings.NewReader(sseBody)), ContentLength: int64(len(sseBody))},
	}}
	got, err := testClient(t, sse).Model(modelReference)
	if err != nil || got.(map[string]any)["ok"] != true {
		t.Fatalf("sse %#v %v", got, err)
	}
}

func TestDisconnect(t *testing.T) {
	denied := &http.Response{StatusCode: 401, Header: make(http.Header), Body: io.NopCloser(strings.NewReader("")), ContentLength: 0}
	noContent := &http.Response{StatusCode: 204, Header: make(http.Header), Body: io.NopCloser(strings.NewReader("")), ContentLength: 0}
	transport := &script{t: t, responses: []*http.Response{denied, noContent}}
	client := testClient(t, transport)
	err := client.Disconnect()
	if err == nil || err.(*Error).Code != "REVOCATION_UNCONFIRMED" || err.(*Error).Status != 401 {
		t.Fatalf("disconnect 401: %v", err)
	}
	if err := client.Disconnect(); err != nil {
		t.Fatal(err)
	}
	for i, request := range transport.requests {
		if request.URL.String() != "https://wan30.video/api/mcp/disconnect/" {
			t.Fatalf("url %s", request.URL)
		}
		if request.Header.Get("Mcp-Session-Id") != "" || request.Header.Get("Content-Type") != "" {
			t.Fatalf("headers %#v", request.Header)
		}
		if len(transport.bodies[i]) != 0 {
			t.Fatalf("body %q", transport.bodies[i])
		}
	}
}

func TestGenerateConfirmationStaysLocal(t *testing.T) {
	path := writeInput(t, `{"modelId":"wan30-text-to-video","prompt":"A paper boat"}`)
	blocked := &script{t: t}
	output := &bytes.Buffer{}
	code := Run([]string{"generate", "--input", path, "--request-id", "paper-boat-request"}, func(string) string { return "" }, output, &http.Client{Transport: blocked})
	if code != 1 || !strings.Contains(output.String(), "SPEND_NOT_CONFIRMED") || !strings.Contains(output.String(), "purchased wan30.video credits") || !strings.Contains(output.String(), "check-in") {
		t.Fatalf("blocked %d %s", code, output)
	}
	if len(blocked.requests) != 0 {
		t.Fatalf("blocked made %d requests", len(blocked.requests))
	}
	again := &bytes.Buffer{}
	if code := Run([]string{"generate", "--input", path}, func(string) string { return "" }, again, &http.Client{Transport: blocked}); code != 1 || !strings.Contains(again.String(), "SPEND_NOT_CONFIRMED") {
		t.Fatalf("default %d %s", code, again)
	}

	transport := &script{t: t, responses: []*http.Response{
		ok(0, `{"protocolVersion":"2025-11-25","capabilities":{}}`, "session-a"),
		accepted(),
		tool(1, `{"taskId":"task-1"}`, "session-a"),
		ok(0, `{"protocolVersion":"2025-11-25","capabilities":{}}`, "session-a"),
		accepted(),
		tool(1, `{"taskId":"task-1"}`, "session-a"),
	}}
	output.Reset()
	code = Run([]string{"generate", "--input", path, "--request-id", "paper-boat-request", "--confirm-spend", "--token", "test-token"}, func(string) string { return "" }, output, &http.Client{Transport: transport})
	if code != 0 || !strings.Contains(output.String(), `"taskId":"task-1"`) {
		t.Fatalf("generate %d %s", code, output)
	}
	body := string(transport.bodies[len(transport.bodies)-1])
	if !strings.Contains(body, `"requestId":"paper-boat-request"`) || strings.Contains(body, "confirm") {
		t.Fatalf("wire %s", body)
	}
	output.Reset()
	code = Run([]string{"generate", "--input", path, "--request-id", "paper-boat-request", "--confirm-spend", "--token", "test-token"}, func(string) string { return "" }, output, &http.Client{Transport: transport})
	if code != 0 {
		t.Fatalf("retry %d %s", code, output)
	}
	retry := string(transport.bodies[len(transport.bodies)-1])
	if !strings.Contains(retry, `"requestId":"paper-boat-request"`) || strings.Contains(retry, "confirmSpend") || strings.Contains(retry, "confirm_spend") || strings.Contains(retry, "confirm-spend") {
		t.Fatalf("retry wire %s", retry)
	}

	fresh := &script{t: t, responses: []*http.Response{
		ok(0, `{"protocolVersion":"2025-11-25","capabilities":{}}`, "session-a"),
		accepted(),
		tool(1, `{"taskId":"task-2"}`, "session-a"),
	}}
	output.Reset()
	code = Run([]string{"generate", "--input", path, "--confirm-spend", "--token", "test-token"}, func(string) string { return "" }, output, &http.Client{Transport: fresh})
	if code != 0 {
		t.Fatalf("fresh %d %s", code, output)
	}
	var sent struct {
		Params struct {
			Arguments struct {
				RequestID string `json:"requestId"`
			} `json:"arguments"`
		} `json:"params"`
	}
	if err := decodeObjectInto(fresh.bodies[len(fresh.bodies)-1], &sent); err != nil {
		t.Fatal(err)
	}
	if !regexp.MustCompile(`^[A-Za-z0-9_-]{16,128}$`).MatchString(sent.Params.Arguments.RequestID) {
		t.Fatalf("generated id %q", sent.Params.Arguments.RequestID)
	}
}

func TestMissingTokenDoesNotReadFiles(t *testing.T) {
	output := &bytes.Buffer{}
	code := Run([]string{"account"}, func(name string) string { return "" }, output, nil)
	if code != 1 || !strings.Contains(output.String(), "INVALID_TOKEN") || strings.Contains(output.String(), "WAN30_ACCESS_TOKEN=") {
		t.Fatalf("missing %d %s", code, output)
	}
	_, err := NewClient("https://wan30.video", "", nil)
	if err == nil || err.(*Error).Code != "INVALID_TOKEN" {
		t.Fatalf("client token %v", err)
	}
}

func TestHelp(t *testing.T) {
	output := &bytes.Buffer{}
	if code := Run(nil, func(string) string { return "" }, output, nil); code != 0 || !strings.Contains(output.String(), "--confirm-spend") {
		t.Fatalf("help %d %s", code, output)
	}
}

func writeInput(t *testing.T, text string) string {
	t.Helper()
	file, err := os.CreateTemp(t.TempDir(), "input-*.json")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.WriteString(text); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	return file.Name()
}

func decodeObjectInto(payload []byte, dest any) error {
	return json.NewDecoder(bytes.NewReader(payload)).Decode(dest)
}
