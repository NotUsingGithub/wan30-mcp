wan30_new_id <- function() {
  bytes <- as.raw(sample.int(256L, 16L, replace = TRUE) - 1L)
  bytes[7] <- as.raw(bitwOr(bitwAnd(as.integer(bytes[7]), 0x0f), 0x40))
  bytes[9] <- as.raw(bitwOr(bitwAnd(as.integer(bytes[9]), 0x3f), 0x80))
  hex <- paste(format(as.hexmode(as.integer(bytes)), width = 2), collapse = "")
  paste0(
    substring(hex, 1, 8), "-",
    substring(hex, 9, 12), "-",
    substring(hex, 13, 16), "-",
    substring(hex, 17, 20), "-",
    substring(hex, 21, 32)
  )
}

#' @export
print.wan30_client <- function(x, ...) {
  cat("<wan30_client origin=", x$origin, ">\n", sep = "")
  invisible(x)
}

wan30_tool_error <- function(result) {
  text <- NULL
  content <- result$content
  if (is.list(content) && length(content)) {
    first <- content[[1]]
    if (is.list(first) && is.character(first$text) && length(first$text) == 1L) {
      text <- first$text
    }
  }
  parsed <- NULL
  if (!is.null(text)) {
    parsed <- tryCatch(wan30_read_json(text), wan30_error = function(error) NULL)
  }
  code <- "TOOL_ERROR"
  message <- if (!is.null(text) && nzchar(text)) text else "Tool call failed."
  if (is.list(parsed) && !is.null(names(parsed))) {
    if (is.character(parsed$code) && nzchar(parsed$code)) {
      code <- parsed$code
    }
    if (is.character(parsed$message) && nzchar(parsed$message)) {
      message <- parsed$message
    }
  }
  wan30_fail(code, message)
}

wan30_call <- function(client, name, arguments) {
  result <- wan30_call_tool(client, name, if (length(arguments)) arguments else wan30_empty_object())
  if (isTRUE(result$isError)) {
    wan30_tool_error(result)
  }
  structured <- result$structuredContent
  if (!is.list(structured) || !("data" %in% names(structured))) {
    wan30_fail("INVALID_RESPONSE", "The server returned an unreadable response.")
  }
  structured$data
}

#' Create a Wan30 client
#'
#' The client reads \code{WAN30_ACCESS_TOKEN} and, when \code{origin} is
#' omitted, \code{WAN30_ORIGIN} from the process environment. It does not
#' read \code{.env} files or a credential store.
#'
#' @param token Bearer token. The process environment is used only when this
#'   is missing.
#' @param origin Exact HTTPS origin. Defaults to \code{https://wan30.video}.
#' @param request Optional function replacing HTTP. Tests pass this. The
#'   default uses the curl package and does not follow redirects.
#' @param env Lookup with the same shape as \code{Sys.getenv}. Tests pass this.
#' @return An object of class \code{wan30_client}.
#' @export
wan30_client <- function(token = NULL, origin = NULL, request = NULL, env = Sys.getenv) {
  if (!is.character(token) || length(token) != 1L || !nzchar(token) || is.na(token)) {
    token <- env("WAN30_ACCESS_TOKEN", unset = "")
  }
  if (!is.character(token) || length(token) != 1L || !nzchar(token) || is.na(token)) {
    wan30_fail("INVALID_TOKEN", "Access token is not a Wan30 API authorization. Sign in again.")
  }
  if (!is.character(origin) || length(origin) != 1L || !nzchar(origin) || is.na(origin)) {
    from_env <- env("WAN30_ORIGIN", unset = "")
    origin <- if (is.character(from_env) && length(from_env) == 1L && nzchar(from_env)) {
      from_env
    } else {
      "https://wan30.video"
    }
  }
  state <- new.env(parent = emptyenv())
  state$session_id <- NULL
  state$protocol_version <- NULL
  state$next_id <- 0L
  state$ready <- FALSE
  structure(
    list(
      origin = wan30_normalize_origin(origin),
      token = token,
      request = if (is.null(request)) wan30_curl_exchange else request,
      state = state
    ),
    class = "wan30_client"
  )
}

#' Account credits and generation access
#'
#' Calls the \code{account_status} tool. The tool takes no arguments.
#'
#' @param client A \code{wan30_client}.
#' @return The tool's structured data.
#' @export
wan30_account <- function(client) {
  wan30_call(client, "account_status", wan30_empty_object())
}

#' Supported generation models
#'
#' Calls the \code{list_models} tool.
#'
#' @param client A \code{wan30_client}.
#' @return The tool's structured data.
#' @export
wan30_models <- function(client) {
  wan30_call(client, "list_models", wan30_empty_object())
}

#' Input options for one model
#'
#' Calls the \code{get_model} tool.
#'
#' @param client A \code{wan30_client}.
#' @param model_id One of \code{wan30-reference-to-video},
#'   \code{wan30-text-to-video}, or \code{wan30-image-to-video}.
#' @return The tool's structured data.
#' @export
wan30_model <- function(client, model_id) {
  wan30_validate_model_id(model_id)
  wan30_call(client, "get_model", list(modelId = model_id))
}

#' Quote credits before generation
#'
#' Calls \code{estimate_generation}. Omitted optional fields are not filled in.
#' This does not spend credits.
#'
#' @param client A \code{wan30_client}.
#' @param input Generation object using the published field names.
#' @return The tool's structured data.
#' @export
wan30_estimate <- function(client, input) {
  wan30_call(client, "estimate_generation", list(input = wan30_validate_generation(input)))
}

#' Generate a video after an explicit local confirmation
#'
#' The service is called only when \code{confirm_spend} is exactly \code{TRUE}.
#' The request body is \code{input} and \code{requestId}. \code{confirm_spend}
#' is not sent. When \code{request_id} is omitted, an id is created after the
#' confirmation check. Reuse that id on a retry.
#'
#' @param client A \code{wan30_client}.
#' @param input Generation object. Call \code{wan30_estimate} on the same
#'   object before confirming.
#' @param request_id Idempotency key matching
#'   \code{^[A-Za-z0-9_-]{16,128}$}.
#' @param confirm_spend Local confirmation. The default \code{FALSE} does not
#'   call the service.
#' @return The tool's structured data.
#' @examples
#' message <- tryCatch(
#'   wan30_generate(
#'     wan30_client(token = "example-token", env = function(name, unset = "") ""),
#'     list(modelId = "wan30-text-to-video", prompt = "A paper boat")
#'   ),
#'   wan30_error = function(error) conditionMessage(error)
#' )
#' stopifnot(grepl("purchased wan30.video credits", message))
#' @export
wan30_generate <- function(client, input, request_id = NULL, confirm_spend = FALSE) {
  input <- wan30_validate_generation(input)
  if (!is.null(request_id)) {
    wan30_validate_request_id(request_id)
  }
  if (!isTRUE(confirm_spend)) {
    wan30_fail("SPEND_NOT_CONFIRMED", wan30_spend_message)
  }
  if (is.null(request_id)) {
    request_id <- wan30_new_id()
  }
  wan30_call(client, "generate_video", list(input = input, requestId = request_id))
}

#' Recent video tasks
#'
#' Calls \code{list_tasks}. A missing \code{limit} is not sent.
#'
#' @param client A \code{wan30_client}.
#' @param limit Optional integer from 1 to 50.
#' @return The tool's structured data.
#' @export
wan30_tasks <- function(client, limit = NULL) {
  wan30_validate_limit(limit)
  arguments <- if (is.null(limit)) wan30_empty_object() else list(limit = limit)
  wan30_call(client, "list_tasks", arguments)
}

#' One video task
#'
#' Calls \code{get_task}.
#'
#' @param client A \code{wan30_client}.
#' @param task_id Task id, 1 to 128 characters.
#' @return The tool's structured data.
#' @export
wan30_task <- function(client, task_id) {
  wan30_validate_task_id(task_id)
  wan30_call(client, "get_task", list(taskId = task_id))
}

#' Drop the local MCP session
#'
#' This does not call the service.
#'
#' @param client A \code{wan30_client}.
#' @return The client, invisibly.
#' @export
wan30_close <- function(client) {
  wan30_reset_session(client)
  invisible(client)
}

#' Revoke the server session
#'
#' POST \code{{origin}/api/mcp/disconnect/} with only the bearer token and an
#' empty body. HTTP 401 from this call is \code{REVOCATION_UNCONFIRMED}.
#'
#' @param client A \code{wan30_client}.
#' @return \code{NULL}, invisibly.
#' @export
wan30_disconnect <- function(client) {
  wan30_disconnect_request(client)
}
