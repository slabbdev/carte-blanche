# Publish an SDK

This example shows how to publish a generated SDK using the APIMatic CLI.

---

## Publish the SDK

```
apimatic sdk publish --profile-id=b2c3d4e5f6a1b2c3d4e5f6a1 --language=typescript --version=1.0.0 --publish-type=sourcecode --force
```

Output:

```
T   Publish SDK
|
o  Profile search complete.
|
•  Version tags will not be created in your Git repository because you have opted to publish Source Code only.
|
o  SDK generated successfully.
|
•  The generated SDK can be found at '<project-dir>\sdk\typescript'.
|
o  Publishing initiated.
|
•  Publishing is running for the following:
|
|    Profile:   <profile-name>
|    Language:  typescript
|    Version:   1.0.0
|    Targets:   Source Code
|
o  Source Code: [Published]
|
o  Next Steps ------------------------------------------------------------------------------------------+
|                                                                                                       |
|  To view publishing logs, please visit:                                                               |
|  https://dash.apimatic.io/publish/<publish-id>/logs/<log-id>                                          |
|                                                                                                       |
+-------------------------------------------------------------------------------------------------------+
|
—  Succeeded
```
