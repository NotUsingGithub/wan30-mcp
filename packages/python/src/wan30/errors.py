"""Errors raised by the Wan30 client.

String codes match `@wan30/cli` 0.1.0 where that client defines one.
`SPEND_NOT_CONFIRMED` is local: it is raised before any network call.
"""


class WanClientError(Exception):
    def __init__(self, code, message, status=0):
        super().__init__(message)
        self.code = code
        self.status = status
        self.rpc_code = None

    def __str__(self):
        return self.args[0]
