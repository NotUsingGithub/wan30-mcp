module wan30.errors;

class Wan30Exception : Exception
{
    string code;
    int status;
    long rpcCode;

    this(string code, string message, int status = 0, string file = __FILE__, size_t line = __LINE__)
    {
        super(message, file, line);
        this.code = code;
        this.status = status;
    }
}

enum spendNotConfirmed =
    "generate spends purchased wan30.video credits. " ~
    "Sign-up, check-in and gift credits alone do not qualify. " ~
    "Pass confirmSpend=true after estimate().";

enum authRequiredMessage =
    "Authorization expired or was revoked. Run wan30 auth login.";
