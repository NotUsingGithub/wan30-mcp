library(wan30)

stop_if <- function(condition, message) {
  if (!isTRUE(condition)) {
    stop(message, call. = FALSE)
  }
}

same <- function(left, right) {
  if (is.numeric(left) && is.numeric(right) && !is.logical(left) && !is.logical(right)) {
    return(length(left) == 1L && length(right) == 1L && !is.na(left) && !is.na(right) && left == right)
  }
  identical(left, right)
}

bytes <- function(text) charToRaw(text)

ok <- function(id, result, session) {
  list(
    status = 200L,
    headers = list("content-type" = "application/json", "mcp-session-id" = session),
    body = bytes(sprintf('{"jsonrpc":"2.0","id":%s,"result":%s}', id, result))
  )
}

tool <- function(id, data, session) {
  ok(id, sprintf('{"structuredContent":{"data":%s}}', data), session)
}

accepted <- function() {
  list(status = 202L, headers = list(), body = raw(0))
}

scripted <- function(responses) {
  calls <- new.env(parent = emptyenv())
  calls$items <- list()
  calls$index <- 0L
  request <- function(method, url, headers, body, timeout_seconds, max_bytes) {
    calls$index <- calls$index + 1L
    calls$items[[length(calls$items) + 1L]] <- list(
      method = method,
      url = url,
      headers = headers,
      body = body,
      timeout_seconds = timeout_seconds,
      max_bytes = max_bytes
    )
    responses[[calls$index]]
  }
  list(request = request, calls = calls)
}

make <- function(responses) {
  script <- scripted(responses)
  client <- wan30_client(
    token = "test-token",
    origin = "https://wan30.video",
    request = script$request,
    env = function(name, unset = "") ""
  )
  list(client = client, calls = script$calls)
}

parsed <- function(call) {
  jsonlite::fromJSON(rawToChar(call$body), simplifyVector = FALSE)
}

code_of <- function(expr) {
  tryCatch(expr, wan30_error = function(error) error)
}

handshake <- make(list(
  ok(0, '{"protocolVersion":"2025-11-25","capabilities":{}}', "session-a"),
  accepted(),
  tool(1, '{"credits":3}', "session-a"),
  tool(2, '[{"id":"wan30-text-to-video"}]', "session-a")
))
account <- wan30_account(handshake$client)
stop_if(same(account$credits, 3), "account credits")
stop_if(length(handshake$calls$items) == 3L, "handshake count")
initialize <- parsed(handshake$calls$items[[1]])
stop_if(identical(initialize$method, "initialize"), "initialize method")
stop_if(same(initialize$id, 0), "initialize id")
stop_if(identical(initialize$params$clientInfo$name, "wan30-r"), "client name")
stop_if(identical(initialize$params$clientInfo$version, "0.1.0"), "client version")
stop_if(!("mcp-session-id" %in% names(handshake$calls$items[[1]]$headers)), "no session yet")
notice <- parsed(handshake$calls$items[[2]])
stop_if(identical(notice$method, "notifications/initialized"), "notify method")
stop_if(is.null(notice$id), "notify has no id")
stop_if(is.null(notice$params), "notify has no params")
stop_if(identical(handshake$calls$items[[2]]$headers[["mcp-session-id"]], "session-a"), "notify session")
stop_if(
  identical(handshake$calls$items[[2]]$headers[["mcp-protocol-version"]], "2025-11-25"),
  "notify protocol"
)
stop_if(identical(parsed(handshake$calls$items[[3]])$params$name, "account_status"), "account tool")
stop_if(length(parsed(handshake$calls$items[[3]])$params$arguments) == 0L, "account arguments")
models <- wan30_models(handshake$client)
stop_if(identical(models[[1]]$id, "wan30-text-to-video"), "models payload")
stop_if(same(parsed(handshake$calls$items[[4]])$id, 2), "second tool id")

quote_client <- make(list(
  ok(0, '{"protocolVersion":"2025-11-25","capabilities":{}}', "session-a"),
  accepted(),
  tool(1, '{"quoted":true}', "session-a")
))
input <- list(modelId = "wan30-text-to-video", prompt = "A paper boat")
quoted <- wan30_estimate(quote_client$client, input)
stop_if(isTRUE(quoted$quoted), "quoted")
sent <- parsed(quote_client$calls$items[[length(quote_client$calls$items)]])$params$arguments$input
stop_if(identical(sent$modelId, "wan30-text-to-video"), "model sent")
stop_if(is.null(sent$durationSeconds), "duration not injected")
stop_if(is.null(sent$resolution), "resolution not injected")
body <- rawToChar(quote_client$calls$items[[length(quote_client$calls$items)]]$body)
stop_if(!grepl("confirmSpend", body, fixed = TRUE), "confirm not in estimate")
stop_if(!grepl("confirm_spend", body, fixed = TRUE), "local flag not in estimate")

blocked <- make(list())
blocked_error <- code_of(wan30_generate(
  blocked$client, input, request_id = "paper-boat-request"
))
stop_if(identical(blocked_error$code, "SPEND_NOT_CONFIRMED"), "spend code")
stop_if(grepl("purchased wan30.video credits", blocked_error$message), "spend credits")
stop_if(grepl("check-in", blocked_error$message), "spend check-in")
stop_if(length(blocked$calls$items) == 0L, "no call without confirmation")
blocked_again <- code_of(wan30_generate(blocked$client, input))
stop_if(identical(blocked_again$code, "SPEND_NOT_CONFIRMED"), "default does not spend")

generated <- make(list(
  ok(0, '{"protocolVersion":"2025-11-25","capabilities":{}}', "session-a"),
  accepted(),
  tool(1, '{"taskId":"task-1"}', "session-a"),
  tool(2, '{"taskId":"task-1"}', "session-a")
))
created <- wan30_generate(
  generated$client, input,
  request_id = "paper-boat-request", confirm_spend = TRUE
)
stop_if(identical(created$taskId, "task-1"), "task id")
arguments <- parsed(generated$calls$items[[length(generated$calls$items)]])$params$arguments
stop_if(identical(arguments$requestId, "paper-boat-request"), "request id sent")
wire <- rawToChar(generated$calls$items[[length(generated$calls$items)]]$body)
stop_if(!grepl("confirmSpend", wire, fixed = TRUE), "confirmSpend absent")
stop_if(!grepl("confirm_spend", wire, fixed = TRUE), "confirm_spend absent")
stop_if(!grepl("confirm-spend", wire, fixed = TRUE), "confirm-spend absent")
wan30_generate(
  generated$client, input,
  request_id = "paper-boat-request", confirm_spend = TRUE
)
again <- parsed(generated$calls$items[[length(generated$calls$items)]])$params$arguments$requestId
stop_if(identical(again, "paper-boat-request"), "same request id")

fresh <- make(list(
  ok(0, '{"protocolVersion":"2025-11-25","capabilities":{}}', "session-a"),
  accepted(),
  tool(1, '{"taskId":"task-2"}', "session-a")
))
fresh_task <- wan30_generate(fresh$client, input, confirm_spend = TRUE)
fresh_id <- parsed(fresh$calls$items[[length(fresh$calls$items)]])$params$arguments$requestId
stop_if(identical(fresh_task$taskId, "task-2"), "generated task")
stop_if(grepl("^[A-Za-z0-9_-]{16,128}$", fresh_id, perl = TRUE), "generated request id")

expired <- make(list(
  list(status = 401L, headers = list(), body = raw(0)),
  ok(0, '{"protocolVersion":"2025-11-25","capabilities":{}}', "session-b"),
  accepted(),
  tool(1, "[]", "session-b")
))
denied <- code_of(wan30_tasks(expired$client))
stop_if(identical(denied$code, "AUTH_REQUIRED"), "auth code")
stop_if(identical(denied$status, 401L), "auth status")
stop_if(grepl("wan30 auth login", denied$message), "auth message")
tasks <- wan30_tasks(expired$client, limit = 20)
stop_if(length(tasks) == 0L, "task list")
last <- parsed(expired$calls$items[[length(expired$calls$items)]])
stop_if(same(last$id, 1), "reset id")
stop_if(same(last$params$arguments$limit, 20), "limit sent")
stop_if(
  identical(expired$calls$items[[length(expired$calls$items)]]$headers[["mcp-session-id"]], "session-b"),
  "new session"
)

error_body <- paste0(
  '{"jsonrpc":"2.0","id":1,"result":{"isError":true,"content":[',
  '{"type":"text","text":"{\\"code\\":\\"QUOTE_REQUIRED\\",\\"message\\":\\"Estimate first.\\"}"}]}}'
)
errored <- make(list(
  ok(0, '{"protocolVersion":"2025-11-25","capabilities":{}}', "session-a"),
  accepted(),
  list(
    status = 200L,
    headers = list(
      "content-type" = "application/json; charset=utf-8",
      "mcp-session-id" = "session-a"
    ),
    body = bytes(error_body)
  )
))
quote_required <- code_of(wan30_task(errored$client, "task-1"))
stop_if(identical(quote_required$code, "QUOTE_REQUIRED"), "tool code")
stop_if(identical(quote_required$message, "Estimate first."), "tool message")

rejected <- make(list(
  ok(0, '{"protocolVersion":"2025-11-25","capabilities":{}}', "session-a"),
  accepted(),
  accepted()
))
http_202 <- code_of(wan30_model(rejected$client, "wan30-text-to-video"))
stop_if(identical(http_202$code, "INVALID_RESPONSE"), "202 code")
stop_if(identical(http_202$status, 202L), "202 status")

bad_image <- code_of(wan30:::wan30_validate_generation(list(
  prompt = "A paper boat",
  imageUrls = "http://cdn.example/a.png"
)))
stop_if(identical(bad_image$code, "INVALID_INPUT"), "http image code")
stop_if(grepl("HTTPS", bad_image$message), "http image message")
bad_duration <- code_of(wan30:::wan30_validate_generation(list(
  modelId = "wan30-text-to-video",
  prompt = "A paper boat",
  durationSeconds = TRUE
)))
stop_if(identical(bad_duration$code, "INVALID_INPUT"), "logical duration")
stop_if(identical(wan30:::wan30_normalize_origin("https://wan30.video"), "https://wan30.video"), "origin")
bad_port <- code_of(wan30:::wan30_normalize_origin("https://wan30.video:443"))
stop_if(identical(bad_port$code, "INVALID_ORIGIN"), "explicit 443")

missing <- code_of(wan30_client(env = function(name, unset = "") ""))
stop_if(identical(missing$code, "INVALID_TOKEN"), "missing token")
looked_up <- wan30_client(env = function(name, unset = "") {
  if (identical(name, "WAN30_ACCESS_TOKEN")) "test-token" else "https://wan30.video"
})
stop_if(identical(looked_up$origin, "https://wan30.video"), "origin from lookup")

calls <- new.env(parent = emptyenv())
calls$items <- list()
calls$index <- 0L
responses <- list(
  list(status = 401L, headers = list(), body = raw(0)),
  list(status = 204L, headers = list(), body = raw(0))
)
disconnect_request <- function(method, url, headers, body, timeout_seconds, max_bytes) {
  calls$index <- calls$index + 1L
  calls$items[[length(calls$items) + 1L]] <- list(
    method = method, url = url, headers = headers, body = body, max_bytes = max_bytes
  )
  responses[[calls$index]]
}
denied_client <- wan30_client(
  token = "test-token",
  env = function(name, unset = "") "",
  request = disconnect_request
)
revoked <- code_of(wan30_disconnect(denied_client))
stop_if(identical(revoked$code, "REVOCATION_UNCONFIRMED"), "disconnect 401 code")
stop_if(identical(revoked$status, 401L), "disconnect 401 status")
stop_if(identical(calls$items[[1]]$url, "https://wan30.video/api/mcp/disconnect/"), "disconnect url")
stop_if(!("mcp-session-id" %in% names(calls$items[[1]]$headers)), "disconnect has no session")
stop_if(length(calls$items[[1]]$body) == 0L, "disconnect empty body")
stop_if(identical(calls$items[[1]]$max_bytes, 65536), "disconnect limit")
wan30_disconnect(wan30_client(
  token = "test-token",
  env = function(name, unset = "") "",
  request = disconnect_request
))
stop_if(identical(calls$items[[2]]$url, "https://wan30.video/api/mcp/disconnect/"), "disconnect 204")

messages <- wan30:::wan30_parse_sse(bytes(
  "event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"ok\":true}}\n\n"
))
stop_if(length(messages) == 1L, "sse count")
stop_if(same(messages[[1]]$id, 1), "sse id")
stop_if(isTRUE(messages[[1]]$result$ok), "sse result")

encoded <- jsonlite::fromJSON(
  rawToChar(wan30:::wan30_write_json(list(
    imageUrls = "https://cdn.example/a.png",
    prompt = "A paper boat"
  ))),
  simplifyVector = FALSE
)
stop_if(is.list(encoded$imageUrls) && is.null(names(encoded$imageUrls)), "imageUrls stays an array")
stop_if(identical(encoded$imageUrls[[1]], "https://cdn.example/a.png"), "one image url")
empty <- jsonlite::fromJSON(
  rawToChar(wan30:::wan30_write_json(wan30:::wan30_empty_object())),
  simplifyVector = FALSE
)
stop_if(is.list(empty) && length(empty) == 0L && !is.null(names(empty)), "empty object")

cat("wan30 tests passed\n")
