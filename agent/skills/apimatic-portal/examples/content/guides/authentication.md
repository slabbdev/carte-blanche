---
title: Authentication
description: Create and use an API key.
---

Send your key in the `Authorization` header:

```bash title="Terminal"
curl https://api.acme.com/v1/payments \
  -H "Authorization: Bearer $ACME_API_KEY"
```

<Callout type="warn" title="Keep keys secret">
  Never commit API keys to source control.
</Callout>
