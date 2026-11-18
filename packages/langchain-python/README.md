# langchain-wan30

LangChain tools for a [wan30.video](https://wan30.video/) account. They call
the `wan30` Python client, which uses the same MCP endpoint as `@wan30/cli`
0.1.0.

**Access requires remaining purchased credits.** Sign-up, check-in and gift
credits alone do not qualify. Buy credits at <https://wan30.video/pricing/>.

This package is published by Wan30 and NotUsingGithub. It is not an official
Alibaba, DashScope, or Tongyi client, and it does not call those APIs.

## Install

```sh
pip install langchain-wan30
```

## Use

```python
from wan30 import WanClient
from langchain_wan30 import get_tools

client = WanClient.from_environment()
tools = get_tools(client)  # account, models, estimate, tasks
# tools = get_tools(client, include_generate=True)
```

`get_tools` leaves out `generate_video` unless `include_generate=True`.
When that tool is present, it still does not call the service unless the
invocation sets `confirm_spend` to true. The flag is not part of the hosted
payload. Retry with the same `requestId`; the service uses it to avoid a
second charge.

Read the account and estimate before spending. A generation uses the same
purchased-credit balance as the website.
