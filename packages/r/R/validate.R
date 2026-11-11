wan30_model_ids <- c(
  "wan30-reference-to-video",
  "wan30-text-to-video",
  "wan30-image-to-video"
)

wan30_resolutions <- c("480p", "720p", "1080p")

wan30_aspect_ratios <- c("16:9", "9:16", "1:1", "4:3", "3:4")

wan30_reference_keys <- c(
  "prompt", "durationSeconds", "resolution", "aspectRatio",
  "hasAudio", "modelId", "imageUrls"
)

wan30_text_keys <- setdiff(wan30_reference_keys, "imageUrls")

wan30_utf16_length <- function(value) {
  if (!is.character(value) || length(value) != 1L || is.na(value)) {
    wan30_fail("INVALID_INPUT", "The value is not valid UTF-8.")
  }
  encoded <- iconv(value, from = "UTF-8", to = "UTF-16LE", toRaw = TRUE)[[1]]
  if (is.null(encoded)) {
    wan30_fail("INVALID_INPUT", "The value is not valid UTF-8.")
  }
  length(encoded) / 2
}

wan30_whole_number <- function(value) {
  is.numeric(value) && length(value) == 1L && !is.logical(value) &&
    !is.na(value) && is.finite(value) && value == trunc(value) &&
    abs(value) <= .Machine$integer.max
}

wan30_require_integer <- function(value, label, low, high) {
  if (!wan30_whole_number(value) || value < low || value > high) {
    wan30_fail(
      "INVALID_INPUT",
      sprintf("%s must be an integer from %s to %s.", label, low, high)
    )
  }
}

wan30_normalize_origin <- function(value) {
  if (!is.character(value) || length(value) != 1L || is.na(value) || !nzchar(value)) {
    wan30_fail("INVALID_ORIGIN", wan30_origin_message)
  }
  if (!startsWith(value, "https://")) {
    wan30_fail("INVALID_ORIGIN", wan30_origin_message)
  }
  rest <- substring(value, 9)
  if (!nzchar(rest) || grepl("[/?#@\\\\[:space:]]", rest)) {
    wan30_fail("INVALID_ORIGIN", wan30_origin_message)
  }
  pieces <- strsplit(rest, ":", fixed = TRUE)[[1]]
  if (length(pieces) == 1L) {
    canon <- paste0("https://", tolower(pieces[[1]]))
  } else if (length(pieces) == 2L) {
    host <- pieces[[1]]
    port <- pieces[[2]]
    if (!nzchar(host) || !grepl("^[0-9]+$", port) || identical(port, "443")) {
      wan30_fail("INVALID_ORIGIN", wan30_origin_message)
    }
    canon <- paste0("https://", tolower(host), ":", port)
  } else {
    wan30_fail("INVALID_ORIGIN", wan30_origin_message)
  }
  if (!identical(canon, value) || !nzchar(sub("^https://", "", canon))) {
    wan30_fail("INVALID_ORIGIN", wan30_origin_message)
  }
  value
}

wan30_origin_of <- function(url) {
  if (!is.character(url) || length(url) != 1L || is.na(url)) {
    return(NULL)
  }
  tryCatch(wan30_normalize_origin(sub("^(https://[^/?#]+).*$", "\\1", url)),
           wan30_error = function(error) NULL)
}

wan30_assert_destination <- function(url, origin) {
  if (!identical(wan30_origin_of(url), origin)) {
    wan30_fail("INVALID_ORIGIN", "Unexpected authorization destination.")
  }
  url
}

wan30_https_url <- function(url) {
  if (!is.character(url) || length(url) != 1L || is.na(url)) {
    return(FALSE)
  }
  if (grepl("[[:space:]]", url) || !startsWith(url, "https://")) {
    return(FALSE)
  }
  rest <- substring(url, 9)
  if (!nzchar(rest) || grepl("@", rest, fixed = TRUE)) {
    return(FALSE)
  }
  host <- sub("[/?#].*$", "", rest)
  nzchar(host) && !startsWith(host, ":")
}

wan30_as_object <- function(value) {
  if (is.null(value)) {
    return(setNames(list(), character(0)))
  }
  if (!is.list(value) || is.null(names(value)) || any(!nzchar(names(value)))) {
    wan30_fail("INVALID_INPUT", "Generation input must be an object.")
  }
  value
}

wan30_validate_image_urls <- function(urls, low, high) {
  count <- if (is.null(urls)) 0L else length(urls)
  if (is.null(urls) || !(is.character(urls) || is.list(urls)) || count < low || count > high) {
    wan30_fail(
      "INVALID_INPUT",
      sprintf("imageUrls must contain %s to %s HTTPS URLs.", low, high)
    )
  }
  for (url in urls) {
    if (!wan30_https_url(url)) {
      wan30_fail("INVALID_INPUT", "imageUrls entries must be HTTPS URLs.")
    }
  }
}

wan30_validate_common <- function(value, allowed) {
  extra <- sort(setdiff(names(value), allowed))
  if (length(extra)) {
    wan30_fail(
      "INVALID_INPUT",
      paste0("Unexpected generation field: ", paste(extra, collapse = ", "), ".")
    )
  }
  prompt <- value[["prompt"]]
  if (!is.character(prompt) || length(prompt) != 1L || is.na(prompt)) {
    wan30_fail("INVALID_INPUT", "prompt must be 1 to 1500 characters.")
  }
  prompt_length <- wan30_utf16_length(prompt)
  if (prompt_length < 1 || prompt_length > 1500) {
    wan30_fail("INVALID_INPUT", "prompt must be 1 to 1500 characters.")
  }
  if ("durationSeconds" %in% names(value)) {
    wan30_require_integer(value[["durationSeconds"]], "durationSeconds", 2, 30)
  }
  if ("resolution" %in% names(value) && !(is.character(value[["resolution"]]) &&
        value[["resolution"]] %in% wan30_resolutions)) {
    wan30_fail("INVALID_INPUT", "resolution must be 480p, 720p or 1080p.")
  }
  if ("aspectRatio" %in% names(value) && !(is.character(value[["aspectRatio"]]) &&
        value[["aspectRatio"]] %in% wan30_aspect_ratios)) {
    wan30_fail("INVALID_INPUT", "aspectRatio must be 16:9, 9:16, 1:1, 4:3 or 3:4.")
  }
  if ("hasAudio" %in% names(value) && !is.logical(value[["hasAudio"]])) {
    wan30_fail("INVALID_INPUT", "hasAudio must be a boolean.")
  }
  invisible(value)
}

wan30_validate_generation <- function(value) {
  value <- wan30_as_object(value)
  model_id <- if ("modelId" %in% names(value)) value[["modelId"]] else "wan30-reference-to-video"
  if (!is.character(model_id) || length(model_id) != 1L || !(model_id %in% wan30_model_ids)) {
    wan30_fail("INVALID_INPUT", "modelId must be a supported Wan30 video model.")
  }
  if (identical(model_id, "wan30-text-to-video")) {
    if (!("modelId" %in% names(value))) {
      wan30_fail("INVALID_INPUT", "modelId is required.")
    }
    wan30_validate_common(value, wan30_text_keys)
  } else if (identical(model_id, "wan30-image-to-video")) {
    if (!("modelId" %in% names(value))) {
      wan30_fail("INVALID_INPUT", "modelId is required.")
    }
    wan30_validate_common(value, wan30_reference_keys)
    wan30_validate_image_urls(value[["imageUrls"]], 1, 1)
  } else {
    wan30_validate_common(value, wan30_reference_keys)
    wan30_validate_image_urls(value[["imageUrls"]], 1, 10)
  }
  value
}

wan30_validate_request_id <- function(request_id) {
  if (!is.character(request_id) || length(request_id) != 1L || is.na(request_id) ||
      !grepl("^[A-Za-z0-9_-]{16,128}$", request_id, perl = TRUE)) {
    wan30_fail("INVALID_INPUT", "requestId must match ^[A-Za-z0-9_-]{16,128}$.")
  }
  request_id
}

wan30_validate_model_id <- function(model_id) {
  if (!is.character(model_id) || length(model_id) != 1L || !(model_id %in% wan30_model_ids)) {
    wan30_fail("INVALID_INPUT", "modelId must be a supported Wan30 video model.")
  }
  model_id
}

wan30_validate_task_id <- function(task_id) {
  if (!is.character(task_id) || length(task_id) != 1L || is.na(task_id)) {
    wan30_fail("INVALID_INPUT", "taskId must be 1 to 128 characters.")
  }
  length <- wan30_utf16_length(task_id)
  if (length < 1 || length > 128) {
    wan30_fail("INVALID_INPUT", "taskId must be 1 to 128 characters.")
  }
  task_id
}

wan30_validate_limit <- function(limit) {
  if (!is.null(limit)) {
    wan30_require_integer(limit, "limit", 1, 50)
  }
  limit
}
