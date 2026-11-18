\name{wan30_client}
\alias{wan30_client}
\alias{wan30_account}
\alias{wan30_models}
\alias{wan30_model}
\alias{wan30_estimate}
\alias{wan30_generate}
\alias{wan30_tasks}
\alias{wan30_task}
\alias{wan30_close}
\alias{wan30_disconnect}
\title{Client for a Wan30 video account}
\description{
Talks to the Streamable HTTP MCP endpoint used by the Wan30 command line
client. Purchased wan30.video credits are required for generation.
\code{wan30_estimate} does not spend credits. \code{wan30_generate} does not
call the service unless \code{confirm_spend} is exactly \code{TRUE}, and that
flag is not sent.
}
\usage{
wan30_client(token = NULL, origin = NULL, request = NULL, env = Sys.getenv)

wan30_account(client)

wan30_models(client)

wan30_model(client, model_id)

wan30_estimate(client, input)

wan30_generate(client, input, request_id = NULL, confirm_spend = FALSE)

wan30_tasks(client, limit = NULL)

wan30_task(client, task_id)

wan30_close(client)

wan30_disconnect(client)
}
\arguments{
\item{token}{Bearer token. When omitted, \code{WAN30_ACCESS_TOKEN} is read
from the process environment. \code{.env} files are not read.}

\item{origin}{Exact HTTPS origin. When omitted, \code{WAN30_ORIGIN} or
\code{https://wan30.video} is used.}

\item{request}{Optional function replacing HTTP. The default does not follow
redirects.}

\item{env}{Environment lookup with the same arguments as \code{Sys.getenv}.}

\item{client}{A client created by \code{wan30_client}.}

\item{model_id}{One published model id.}

\item{input}{Generation object. Optional fields that are omitted are not
filled in.}

\item{request_id}{Idempotency key matching
\code{^[A-Za-z0-9_-]{16,128}$}. Created after confirmation when omitted.}

\item{confirm_spend}{Local confirmation. The default does not call the
service and is not sent.}

\item{limit}{Optional integer from 1 to 50. \code{NULL} is not sent.}

\item{task_id}{Task id, 1 to 128 characters.}
}
\value{
\code{wan30_client} returns a client. The tool functions return the
server's structured data. \code{wan30_close} returns the client invisibly.
\code{wan30_disconnect} returns \code{NULL} invisibly.
}
\examples{
message <- tryCatch(
  wan30_generate(
    wan30_client(token = "example-token", env = function(name, unset = "") ""),
    list(modelId = "wan30-text-to-video", prompt = "A paper boat")
  ),
  wan30_error = function(error) conditionMessage(error)
)
stopifnot(grepl("purchased wan30.video credits", message))
}
