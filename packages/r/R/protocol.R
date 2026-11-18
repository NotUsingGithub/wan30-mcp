wan30_protocol_version <- "2025-11-25"

wan30_supported_versions <- c(
  wan30_protocol_version, "2025-06-18", "2025-03-26", "2024-11-05", "2024-10-07"
)

wan30_client_name <- "wan30-r"
wan30_initialize_timeout <- 60
wan30_tool_timeout <- 300
wan30_response_limit <- 2097152
wan30_auth_response_limit <- 65536

wan30_empty_object <- function() {
  setNames(list(), character(0))
}

wan30_unbox_tree <- function(value) {
  if (is.null(value)) {
    return(NULL)
  }
  if (is.list(value)) {
    if (is.null(names(value))) {
      return(lapply(value, wan30_unbox_tree))
    }
    out <- lapply(names(value), function(name) {
      item <- value[[name]]
      if (identical(name, "imageUrls")) {
        lapply(as.list(item), function(url) jsonlite::unbox(as.character(url)))
      } else {
        wan30_unbox_tree(item)
      }
    })
    names(out) <- names(value)
    return(out)
  }
  if (is.atomic(value) && length(value) == 1L) {
    return(jsonlite::unbox(value))
  }
  value
}

wan30_write_json <- function(value) {
  charToRaw(jsonlite::toJSON(wan30_unbox_tree(value), null = "null", auto_unbox = FALSE))
}

wan30_read_json <- function(payload) {
  if (is.raw(payload)) {
    if (!length(payload)) {
      wan30_fail("INVALID_RESPONSE", "The server returned an unreadable response.")
    }
    text <- rawToChar(payload)
  } else {
    text <- payload
  }
  Encoding(text) <- "UTF-8"
  if (is.na(iconv(text, from = "UTF-8", to = "UTF-8"))) {
    wan30_fail("INVALID_RESPONSE", "The server returned an unreadable response.")
  }
  tryCatch(
    jsonlite::fromJSON(text, simplifyVector = FALSE, simplifyDataFrame = FALSE),
    error = function(error) {
      wan30_fail("INVALID_RESPONSE", "The server returned an unreadable response.")
    }
  )
}

wan30_header <- function(headers, name) {
  if (is.null(headers) || !length(headers)) {
    return(NULL)
  }
  key <- tolower(name)
  names(headers) <- tolower(names(headers))
  if (!(key %in% names(headers))) {
    return(NULL)
  }
  headers[[key]]
}

wan30_media_type <- function(value) {
  if (is.null(value) || !nzchar(value)) {
    return("")
  }
  tolower(trimws(strsplit(value, ";", fixed = TRUE)[[1]][[1]]))
}

wan30_parse_sse <- function(payload) {
  text <- if (is.raw(payload)) rawToChar(payload) else payload
  Encoding(text) <- "UTF-8"
  if (is.na(iconv(text, from = "UTF-8", to = "UTF-8"))) {
    wan30_fail("INVALID_RESPONSE", "The server returned an unreadable response.")
  }
  text <- gsub("\r\n", "\n", text, fixed = TRUE)
  text <- gsub("\r", "\n", text, fixed = TRUE)
  lines <- strsplit(text, "\n", fixed = TRUE)[[1]]
  messages <- list()
  data_lines <- character(0)
  event_name <- NULL
  flush <- function() {
    if (length(data_lines) && (is.null(event_name) || !nzchar(event_name) ||
                               identical(event_name, "message"))) {
      messages[[length(messages) + 1L]] <<- wan30_read_json(paste(data_lines, collapse = "\n"))
    }
    data_lines <<- character(0)
    event_name <<- NULL
  }
  for (line in lines) {
    if (!nzchar(line)) {
      flush()
      next
    }
    if (startsWith(line, ":")) {
      next
    }
    split <- regexpr(":", line, fixed = TRUE)
    if (split < 0) {
      field <- line
      value <- ""
    } else {
      field <- substring(line, 1, split - 1)
      value <- substring(line, split + 1)
      if (startsWith(value, " ")) {
        value <- substring(value, 2)
      }
    }
    if (identical(field, "data")) {
      data_lines <- c(data_lines, value)
    } else if (identical(field, "event")) {
      event_name <- value
    }
  }
  flush()
  messages
}

wan30_rpc_messages <- function(response) {
  kind <- wan30_media_type(wan30_header(response$headers, "content-type"))
  if (identical(kind, "text/event-stream")) {
    return(wan30_parse_sse(response$body))
  }
  if (identical(kind, "application/json")) {
    data <- wan30_read_json(response$body)
    if (is.list(data) && is.null(names(data))) {
      return(data)
    }
    if (is.list(data)) {
      return(list(data))
    }
  }
  wan30_fail("INVALID_RESPONSE", "The server returned an unreadable response.")
}

wan30_same_id <- function(left, right) {
  is.numeric(left) && is.numeric(right) && length(left) == 1L && length(right) == 1L &&
    !is.logical(left) && !is.logical(right) && !is.na(left) && !is.na(right) && left == right
}

wan30_matching <- function(messages, id) {
  for (message in messages) {
    if (is.list(message) && "id" %in% names(message) && wan30_same_id(message$id, id)) {
      return(message)
    }
  }
  wan30_fail("INVALID_RESPONSE", "The server returned an unreadable response.")
}

wan30_raise_rpc <- function(message) {
  error <- message$error
  if (!is.list(error) || is.null(names(error))) {
    wan30_fail("INVALID_RESPONSE", "The server returned an unreadable response.")
  }
  rpc_code <- error$code
  text <- error$message
  if (!is.character(text) || length(text) != 1L || !nzchar(text)) {
    text <- "Tool call failed."
  }
  if (wan30_same_id(rpc_code, 401)) {
    wan30_fail("AUTH_REQUIRED", wan30_auth_message, 401L)
  }
  wan30_fail("PROTOCOL_ERROR", paste0("MCP error ", rpc_code, ": ", text), 0L, rpc_code)
}

wan30_session_header <- function(headers) {
  raw <- wan30_header(headers, "mcp-session-id")
  if (is.null(raw) || identical(raw, "")) {
    return(NULL)
  }
  if (!is.character(raw) || length(raw) != 1L) {
    wan30_fail("INVALID_RESPONSE", "The server returned an unreadable response.")
  }
  codes <- utf8ToInt(raw)
  if (!length(codes) || any(codes < 0x21 | codes > 0x7E)) {
    wan30_fail("INVALID_RESPONSE", "The server returned an unreadable response.")
  }
  raw
}

wan30_reset_session <- function(client) {
  client$state$session_id <- NULL
  client$state$protocol_version <- NULL
  client$state$next_id <- 0L
  client$state$ready <- FALSE
  invisible(client)
}

wan30_post <- function(client, payload, timeout, max_bytes, endpoint) {
  token <- client$token
  if (!is.character(token) || length(token) != 1L || !nzchar(token)) {
    wan30_fail("INVALID_TOKEN", "Access token is not a Wan30 API authorization. Sign in again.")
  }
  url <- wan30_assert_destination(paste0(client$origin, endpoint), client$origin)
  headers <- c(
    Authorization = paste0("Bearer ", token),
    "Content-Type" = "application/json",
    Accept = "application/json, text/event-stream"
  )
  if (!identical(endpoint, "/api/mcp/")) {
    headers <- c(Authorization = paste0("Bearer ", token))
  }
  if (identical(endpoint, "/api/mcp/") && !is.null(client$state$session_id)) {
    headers <- c(headers, "mcp-session-id" = client$state$session_id)
  }
  if (identical(endpoint, "/api/mcp/") && !is.null(client$state$protocol_version)) {
    headers <- c(headers, "mcp-protocol-version" = client$state$protocol_version)
  }
  body <- if (identical(endpoint, "/api/mcp/")) wan30_write_json(payload) else raw(0)
  response <- tryCatch(
    client$request("POST", url, headers, body, timeout, max_bytes),
    wan30_error = function(error) stop(error),
    error = function(error) wan30_fail("PROTOCOL_ERROR", "The server response was lost.")
  )
  if (identical(as.integer(response$status), 401L) && identical(endpoint, "/api/mcp/")) {
    wan30_reset_session(client)
    wan30_fail("AUTH_REQUIRED", wan30_auth_message, 401L)
  }
  session <- wan30_session_header(response$headers)
  if (!is.null(session) && identical(endpoint, "/api/mcp/")) {
    client$state$session_id <- session
  }
  response
}

wan30_request_rpc <- function(client, method, params, timeout) {
  id <- client$state$next_id
  client$state$next_id <- id + 1L
  response <- wan30_post(
    client,
    list(method = method, params = params, jsonrpc = "2.0", id = id),
    timeout,
    wan30_response_limit,
    "/api/mcp/"
  )
  status <- as.integer(response$status)
  if (status == 202L || status < 200L || status >= 300L) {
    wan30_fail("INVALID_RESPONSE", paste0("The server returned HTTP ", status, "."), status)
  }
  message <- wan30_matching(wan30_rpc_messages(response), id)
  if ("error" %in% names(message)) {
    wan30_raise_rpc(message)
  }
  if (!is.list(message$result) || is.null(names(message$result))) {
    wan30_fail("INVALID_RESPONSE", "The server returned an unreadable response.")
  }
  message$result
}

wan30_notify <- function(client, method, timeout) {
  response <- wan30_post(
    client,
    list(method = method, jsonrpc = "2.0"),
    timeout,
    wan30_response_limit,
    "/api/mcp/"
  )
  status <- as.integer(response$status)
  if (!(status %in% c(200L, 202L, 204L))) {
    wan30_fail("INVALID_RESPONSE", paste0("The server returned HTTP ", status, "."), status)
  }
  invisible(NULL)
}

wan30_ensure_ready <- function(client) {
  if (isTRUE(client$state$ready)) {
    return(invisible(NULL))
  }
  tryCatch({
    result <- wan30_request_rpc(
      client,
      "initialize",
      list(
        protocolVersion = wan30_protocol_version,
        capabilities = wan30_empty_object(),
        clientInfo = list(name = wan30_client_name, version = "0.1.0")
      ),
      wan30_initialize_timeout
    )
    server_version <- result$protocolVersion
    if (!is.character(server_version) || !(server_version %in% wan30_supported_versions)) {
      wan30_fail(
        "PROTOCOL_ERROR",
        paste0("Server's protocol version is not supported: ", server_version)
      )
    }
    client$state$protocol_version <- server_version
    wan30_notify(client, "notifications/initialized", wan30_initialize_timeout)
    client$state$ready <- TRUE
  }, error = function(error) {
    wan30_reset_session(client)
    stop(error)
  })
}

wan30_call_tool <- function(client, name, arguments) {
  wan30_ensure_ready(client)
  wan30_request_rpc(
    client,
    "tools/call",
    list(name = name, arguments = arguments),
    wan30_tool_timeout
  )
}

wan30_disconnect_request <- function(client) {
  url <- wan30_assert_destination(
    paste0(client$origin, "/api/mcp/disconnect/"),
    client$origin
  )
  token <- client$token
  if (!is.character(token) || length(token) != 1L || !nzchar(token)) {
    wan30_fail("INVALID_TOKEN", "Access token is not a Wan30 API authorization. Sign in again.")
  }
  response <- tryCatch(
    client$request(
      "POST",
      url,
      c(Authorization = paste0("Bearer ", token)),
      raw(0),
      wan30_initialize_timeout,
      wan30_auth_response_limit
    ),
    wan30_error = function(error) stop(error),
    error = function(error) wan30_fail("REVOCATION_UNCONFIRMED", "Could not disconnect.")
  )
  status <- as.integer(response$status)
  if (status < 200L || status >= 300L) {
    wan30_fail("REVOCATION_UNCONFIRMED", "Could not disconnect.", status)
  }
  invisible(NULL)
}
