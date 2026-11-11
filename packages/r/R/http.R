wan30_parse_response_headers <- function(text) {
  headers <- list()
  if (!is.character(text) || !nzchar(text)) {
    return(headers)
  }
  lines <- strsplit(text, "\r\n|\n", perl = TRUE)[[1]]
  for (line in lines) {
    if (!nzchar(line) || !grepl(":", line, fixed = TRUE)) {
      next
    }
    name <- tolower(sub(":.*", "", line))
    value <- sub("^[^:]+:\\s?", "", line)
    headers[[name]] <- value
  }
  headers
}

wan30_curl_exchange <- function(method, url, headers, body, timeout_seconds, max_bytes) {
  if (!identical(method, "POST")) {
    wan30_fail("PROTOCOL_ERROR", "The server response was lost.")
  }
  if (is.null(body)) {
    body <- raw(0)
  } else if (is.character(body)) {
    body <- charToRaw(body)
  }
  handle <- curl::new_handle()
  curl::handle_setopt(
    handle,
    customrequest = "POST",
    post = TRUE,
    postfields = body,
    postfieldsize = length(body),
    timeout = timeout_seconds,
    connecttimeout = timeout_seconds,
    followlocation = FALSE,
    maxfilesize = max_bytes
  )
  if (length(headers)) {
    do.call(curl::handle_setheaders, c(list(handle), as.list(headers)))
  }
  response <- tryCatch(
    curl::curl_fetch_memory(url, handle = handle),
    error = function(error) {
      message <- conditionMessage(error)
      if (grepl("file size", message, ignore.case = TRUE)) {
        wan30_fail("INVALID_RESPONSE", "The server response exceeded the size limit.")
      }
      wan30_fail("PROTOCOL_ERROR", "The server response was lost.")
    }
  )
  if (length(response$content) > max_bytes) {
    wan30_fail("INVALID_RESPONSE", "The server response exceeded the size limit.")
  }
  header_text <- rawToChar(response$headers)
  Encoding(header_text) <- "UTF-8"
  list(
    status = as.integer(response$status_code),
    headers = wan30_parse_response_headers(header_text),
    body = response$content
  )
}
