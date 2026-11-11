package main

import (
	"bytes"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
)

const helpText = `wan30 — client for a wan30.video account

  account
  models | model <modelId>
  estimate --input <json-file>
  generate --input <json-file> [--request-id <id>] --confirm-spend
  tasks [--limit <1..50>]
  task <taskId>
  disconnect
  --origin <https-origin>   Default https://wan30.video
  --token <token>           Or WAN30_ACCESS_TOKEN

estimate does not spend credits. generate does not call the service unless
--confirm-spend is present, and that flag is not sent. Purchased wan30.video
credits are required. Sign-up, check-in and gift credits alone do not qualify.
Results are JSON on stdout. The same --request-id is the idempotency key.
`

const maxInputBytes = 32_768

type options struct {
	help      bool
	command   string
	id        string
	origin    string
	token     string
	input     string
	requestID string
	confirm   bool
	limit     string
	hasLimit  bool
}

func Run(args []string, getenv func(string) string, stdout io.Writer, httpClient *http.Client) int {
	parsed, err := parseArgs(args)
	if err != nil {
		writeError(stdout, err)
		return 1
	}
	if parsed.help || parsed.command == "" {
		fmt.Fprint(stdout, helpText)
		return 0
	}
	if parsed.command == "generate" {
		input, err := generationInput(parsed.input)
		if err != nil {
			writeError(stdout, err)
			return 1
		}
		if parsed.requestID != "" {
			if err := ValidateRequestID(parsed.requestID); err != nil {
				writeError(stdout, err)
				return 1
			}
		}
		if !parsed.confirm {
			writeError(stdout, fail("SPEND_NOT_CONFIRMED", spendMessage, 0))
			return 1
		}
		requestID := parsed.requestID
		if requestID == "" {
			requestID, err = newRequestID()
			if err != nil {
				writeError(stdout, err)
				return 1
			}
		}
		value, err := callClient(parsed, getenv, httpClient, func(client *Client) (any, error) {
			return client.Generate(input, requestID)
		})
		if err != nil {
			writeError(stdout, err)
			return 1
		}
		return writeValue(stdout, value)
	}
	if parsed.confirm || parsed.requestID != "" {
		writeError(stdout, fail("INVALID_INPUT", "--confirm-spend and --request-id belong to generate.", 0))
		return 1
	}
	switch parsed.command {
	case "account", "models", "disconnect":
		if parsed.input != "" || parsed.hasLimit || parsed.id != "" {
			writeError(stdout, fail("INVALID_INPUT", "Unexpected arguments.", 0))
			return 1
		}
	case "model", "task":
		if parsed.id == "" || parsed.input != "" || parsed.hasLimit {
			writeError(stdout, fail("INVALID_INPUT", parsed.command+" requires one argument.", 0))
			return 1
		}
	case "estimate":
		if parsed.input == "" || parsed.hasLimit || parsed.id != "" {
			writeError(stdout, fail("INVALID_INPUT", "--input <json-file> is required.", 0))
			return 1
		}
	case "tasks":
		if parsed.input != "" || parsed.id != "" {
			writeError(stdout, fail("INVALID_INPUT", "Unexpected arguments.", 0))
			return 1
		}
	default:
		writeError(stdout, fail("INVALID_INPUT", "Unknown command. Run wan30 --help.", 0))
		return 1
	}
	value, err := callClient(parsed, getenv, httpClient, func(client *Client) (any, error) {
		switch parsed.command {
		case "account":
			return client.Account()
		case "models":
			return client.Models()
		case "model":
			return client.Model(parsed.id)
		case "estimate":
			input, err := generationInput(parsed.input)
			if err != nil {
				return nil, err
			}
			return client.Estimate(input)
		case "tasks":
			if !parsed.hasLimit {
				return client.Tasks(nil)
			}
			limit, err := ValidateLimit(parsed.limit)
			if err != nil {
				return nil, err
			}
			return client.Tasks(&limit)
		case "task":
			return client.Task(parsed.id)
		case "disconnect":
			return nil, client.Disconnect()
		default:
			return nil, fail("INVALID_INPUT", "Unknown command. Run wan30 --help.", 0)
		}
	})
	if err != nil {
		writeError(stdout, err)
		return 1
	}
	if parsed.command == "disconnect" {
		fmt.Fprintln(stdout, "null")
		return 0
	}
	return writeValue(stdout, value)
}

func callClient(parsed options, getenv func(string) string, httpClient *http.Client, call func(*Client) (any, error)) (any, error) {
	token := parsed.token
	if token == "" && getenv != nil {
		token = getenv("WAN30_ACCESS_TOKEN")
	}
	origin := parsed.origin
	if origin == "" && getenv != nil {
		origin = getenv("WAN30_ORIGIN")
	}
	if origin == "" {
		origin = "https://wan30.video"
	}
	client, err := NewClient(origin, token, httpClient)
	if err != nil {
		return nil, err
	}
	defer client.Close()
	return call(client)
}

func generationInput(path string) (map[string]any, error) {
	if path == "" {
		return nil, fail("INVALID_INPUT", "--input <json-file> is required.", 0)
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, fail("INVALID_INPUT", "Input file is not valid JSON.", 0)
	}
	defer file.Close()
	payload, err := io.ReadAll(io.LimitReader(file, maxInputBytes+1))
	if err != nil || int64(len(payload)) > maxInputBytes {
		return nil, fail("INVALID_INPUT", "Input file is not valid JSON.", 0)
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return nil, fail("INVALID_INPUT", "Input file is not valid JSON.", 0)
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return nil, fail("INVALID_INPUT", "Input file is not valid JSON.", 0)
	}
	return ValidateGeneration(value)
}

func parseArgs(args []string) (options, error) {
	var parsed options
	positionals := make([]string, 0, 2)
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if arg == "--" {
			return options{}, fail("INVALID_INPUT", "Unexpected arguments.", 0)
		}
		if arg == "--help" || arg == "-h" {
			parsed.help = true
			continue
		}
		if arg == "--confirm-spend" {
			parsed.confirm = true
			continue
		}
		name, value, hasValue := strings.Cut(arg, "=")
		if name != "--origin" && name != "--token" && name != "--input" && name != "--request-id" && name != "--limit" {
			if strings.HasPrefix(arg, "-") {
				return options{}, fail("INVALID_INPUT", "Unexpected arguments.", 0)
			}
			positionals = append(positionals, arg)
			continue
		}
		if !hasValue {
			i++
			if i >= len(args) {
				return options{}, fail("INVALID_INPUT", name+" requires a value.", 0)
			}
			value = args[i]
		}
		switch name {
		case "--origin":
			parsed.origin = value
		case "--token":
			parsed.token = value
		case "--input":
			parsed.input = value
		case "--request-id":
			parsed.requestID = value
		case "--limit":
			parsed.limit = value
			parsed.hasLimit = true
		}
	}
	if parsed.help && len(positionals) == 0 && !parsed.confirm && parsed.input == "" && parsed.requestID == "" && !parsed.hasLimit {
		return parsed, nil
	}
	if len(positionals) == 0 {
		bare := parsed.input == "" && parsed.requestID == "" && !parsed.confirm && !parsed.hasLimit && parsed.origin == "" && parsed.token == ""
		if parsed.help || bare {
			parsed.help = true
			return parsed, nil
		}
		return options{}, fail("INVALID_INPUT", "Unknown command. Run wan30 --help.", 0)
	}
	if len(positionals) > 2 {
		return options{}, fail("INVALID_INPUT", "Unexpected positional arguments.", 0)
	}
	parsed.command = positionals[0]
	if len(positionals) == 2 {
		parsed.id = positionals[1]
	}
	return parsed, nil
}

func newRequestID() (string, error) {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", fail("CLI_ERROR", "Command failed. Check your input and try again.", 0)
	}
	bytes[6] = (bytes[6] & 0x0f) | 0x40
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", bytes[0:4], bytes[4:6], bytes[6:8], bytes[8:10], bytes[10:16]), nil
}

func writeValue(stdout io.Writer, value any) int {
	encoded, err := writeJSON(value)
	if err != nil {
		writeError(stdout, fail("CLI_ERROR", "Command failed. Check your input and try again.", 0))
		return 1
	}
	fmt.Fprintf(stdout, "%s\n", encoded)
	return 0
}

func writeError(stdout io.Writer, err error) {
	code := "CLI_ERROR"
	message := "Command failed. Check your input and try again."
	if known, ok := err.(*Error); ok {
		code = known.Code
		message = known.Message
	}
	encoded, marshalErr := writeJSON(map[string]any{
		"error": map[string]any{"code": code, "message": message},
	})
	if marshalErr != nil {
		fmt.Fprintln(stdout, `{"error":{"code":"CLI_ERROR","message":"Command failed. Check your input and try again."}}`)
		return
	}
	fmt.Fprintf(stdout, "%s\n", encoded)
}
