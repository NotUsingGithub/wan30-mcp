wan30_spend_message <- paste(
  "generate spends purchased wan30.video credits.",
  "Sign-up, check-in and gift credits alone do not qualify.",
  "Pass confirm_spend=TRUE after wan30_estimate()."
)

wan30_auth_message <- "Authorization expired or was revoked. Run wan30 auth login."

wan30_origin_message <- "Use an exact HTTPS service origin."

wan30_fail <- function(code, message, status = 0L, rpc_code = NULL) {
  condition <- simpleError(message)
  class(condition) <- c("wan30_error", class(condition))
  condition$code <- code
  condition$status <- as.integer(status)
  condition$rpc_code <- rpc_code
  stop(condition)
}
