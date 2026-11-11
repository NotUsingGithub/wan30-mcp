package main

import (
	"encoding/json"
	"net/url"
	"strconv"
	"strings"
	"unicode/utf16"
)

const (
	modelReference = "wan30-reference-to-video"
	modelText      = "wan30-text-to-video"
	modelImage     = "wan30-image-to-video"
	originMessage  = "Use an exact HTTPS service origin."
	spendMessage   = "generate spends purchased wan30.video credits. Sign-up, check-in and gift credits alone do not qualify. Pass --confirm-spend after estimate."
)

var (
	resolutions  = map[string]bool{"480p": true, "720p": true, "1080p": true}
	aspectRatios = map[string]bool{"16:9": true, "9:16": true, "1:1": true, "4:3": true, "3:4": true}
	commonKeys   = map[string]bool{
		"prompt": true, "durationSeconds": true, "resolution": true,
		"aspectRatio": true, "hasAudio": true, "modelId": true,
	}
)

func fail(code, message string, status int) *Error {
	return &Error{Code: code, Message: message, Status: status}
}

func NormalizeOrigin(value string) (string, error) {
	if value == "" || strings.ContainsAny(value, " \t\r\n") || !strings.HasPrefix(value, "https://") {
		return "", fail("INVALID_ORIGIN", originMessage, 0)
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil ||
		parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.Opaque != "" {
		return "", fail("INVALID_ORIGIN", originMessage, 0)
	}
	if parsed.Port() == "443" || parsed.Hostname() == "" || parsed.Hostname() != strings.ToLower(parsed.Hostname()) {
		return "", fail("INVALID_ORIGIN", originMessage, 0)
	}
	canon := "https://" + parsed.Host
	if canon != value {
		return "", fail("INVALID_ORIGIN", originMessage, 0)
	}
	return value, nil
}

func originOf(raw string) (string, bool) {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil || parsed.Port() == "443" {
		return "", false
	}
	return "https://" + parsed.Host, true
}

func httpsURL(raw string) bool {
	if strings.ContainsAny(raw, " \t\r\n") || !strings.HasPrefix(raw, "https://") || strings.Contains(raw, "@") {
		return false
	}
	rest := strings.TrimPrefix(raw, "https://")
	host := rest
	if i := strings.IndexAny(host, "/?#"); i >= 0 {
		host = host[:i]
	}
	return host != "" && !strings.HasPrefix(host, ":")
}

func utf16Len(value string) int {
	return len(utf16.Encode([]rune(value)))
}

func asObject(value any) (map[string]any, error) {
	object, ok := value.(map[string]any)
	if !ok {
		return nil, fail("INVALID_INPUT", "Generation input must be an object.", 0)
	}
	for key := range object {
		if key == "" {
			return nil, fail("INVALID_INPUT", "Generation input must be an object.", 0)
		}
	}
	return object, nil
}

func requireInteger(value any, label string, low, high int) (int, error) {
	number, ok := value.(json.Number)
	if !ok || strings.ContainsAny(number.String(), ".eE") {
		return 0, fail("INVALID_INPUT", sprintfRange(label, low, high), 0)
	}
	parsed, err := strconv.Atoi(number.String())
	if err != nil || parsed < low || parsed > high {
		return 0, fail("INVALID_INPUT", sprintfRange(label, low, high), 0)
	}
	return parsed, nil
}

func sprintfRange(label string, low, high int) string {
	return label + " must be an integer from " + strconv.Itoa(low) + " to " + strconv.Itoa(high) + "."
}

func validateCommon(object map[string]any, allowed map[string]bool) (map[string]any, error) {
	for key := range object {
		if !allowed[key] {
			return nil, fail("INVALID_INPUT", "Unexpected generation field: "+key+".", 0)
		}
	}
	prompt, ok := object["prompt"].(string)
	if !ok || utf16Len(prompt) < 1 || utf16Len(prompt) > 1500 {
		return nil, fail("INVALID_INPUT", "prompt must be 1 to 1500 characters.", 0)
	}
	out := map[string]any{"prompt": prompt}
	if value, ok := object["durationSeconds"]; ok {
		seconds, err := requireInteger(value, "durationSeconds", 2, 30)
		if err != nil {
			return nil, err
		}
		out["durationSeconds"] = seconds
	}
	if value, ok := object["resolution"]; ok {
		text, isString := value.(string)
		if !isString || !resolutions[text] {
			return nil, fail("INVALID_INPUT", "resolution must be 480p, 720p or 1080p.", 0)
		}
		out["resolution"] = text
	}
	if value, ok := object["aspectRatio"]; ok {
		text, isString := value.(string)
		if !isString || !aspectRatios[text] {
			return nil, fail("INVALID_INPUT", "aspectRatio must be 16:9, 9:16, 1:1, 4:3 or 3:4.", 0)
		}
		out["aspectRatio"] = text
	}
	if value, ok := object["hasAudio"]; ok {
		audio, isBool := value.(bool)
		if !isBool {
			return nil, fail("INVALID_INPUT", "hasAudio must be a boolean.", 0)
		}
		out["hasAudio"] = audio
	}
	return out, nil
}

func imageURLs(value any, low, high int) ([]string, error) {
	items, ok := value.([]any)
	if !ok || len(items) < low || len(items) > high {
		return nil, fail("INVALID_INPUT", "imageUrls must contain "+strconv.Itoa(low)+" to "+strconv.Itoa(high)+" HTTPS URLs.", 0)
	}
	urls := make([]string, 0, len(items))
	for _, item := range items {
		text, isString := item.(string)
		if !isString || !httpsURL(text) {
			return nil, fail("INVALID_INPUT", "imageUrls entries must be HTTPS URLs.", 0)
		}
		urls = append(urls, text)
	}
	return urls, nil
}

func ValidateGeneration(value any) (map[string]any, error) {
	object, err := asObject(value)
	if err != nil {
		return nil, err
	}
	modelID := modelReference
	if present, ok := object["modelId"]; ok {
		text, isString := present.(string)
		if !isString || (text != modelReference && text != modelText && text != modelImage) {
			return nil, fail("INVALID_INPUT", "modelId must be a supported Wan30 video model.", 0)
		}
		modelID = text
	}
	allowed := map[string]bool{}
	for key := range commonKeys {
		allowed[key] = true
	}
	if modelID != modelText {
		allowed["imageUrls"] = true
	}
	out, err := validateCommon(object, allowed)
	if err != nil {
		return nil, err
	}
	switch modelID {
	case modelText:
		if _, ok := object["modelId"]; !ok {
			return nil, fail("INVALID_INPUT", "modelId is required.", 0)
		}
		out["modelId"] = modelText
	case modelImage:
		if _, ok := object["modelId"]; !ok {
			return nil, fail("INVALID_INPUT", "modelId is required.", 0)
		}
		urls, err := imageURLs(object["imageUrls"], 1, 1)
		if err != nil {
			return nil, err
		}
		out["modelId"] = modelImage
		out["imageUrls"] = urls
	default:
		urls, err := imageURLs(object["imageUrls"], 1, 10)
		if err != nil {
			return nil, err
		}
		out["imageUrls"] = urls
		if _, ok := object["modelId"]; ok {
			out["modelId"] = modelReference
		}
	}
	return out, nil
}

func ValidateRequestID(value string) error {
	if len(value) < 16 || len(value) > 128 {
		return fail("INVALID_INPUT", "requestId must match ^[A-Za-z0-9_-]{16,128}$.", 0)
	}
	for _, char := range value {
		if (char < 'A' || char > 'Z') && (char < 'a' || char > 'z') && (char < '0' || char > '9') && char != '_' && char != '-' {
			return fail("INVALID_INPUT", "requestId must match ^[A-Za-z0-9_-]{16,128}$.", 0)
		}
	}
	return nil
}

func ValidateModelID(value string) error {
	if value != modelReference && value != modelText && value != modelImage {
		return fail("INVALID_INPUT", "modelId must be a supported Wan30 video model.", 0)
	}
	return nil
}

func ValidateTaskID(value string) error {
	length := utf16Len(value)
	if length < 1 || length > 128 {
		return fail("INVALID_INPUT", "taskId must be 1 to 128 characters.", 0)
	}
	return nil
}

func ValidateLimit(text string) (int, error) {
	parsed, err := strconv.Atoi(text)
	if err != nil || strconv.Itoa(parsed) != text || parsed < 1 || parsed > 50 {
		return 0, fail("INVALID_INPUT", "limit must be an integer from 1 to 50.", 0)
	}
	return parsed, nil
}
