# Generate, Customize, and Save SDK Changes

This example shows how to generate an SDK with change tracking, customize a generated file, save those customizations, and regenerate with them automatically reapplied.

**Flow:** generate with change tracking → customize → save-changes → regenerate

> This flow needs a CLI release that includes change tracking. Run `apimatic sdk generate --help` first and confirm it lists `--track-changes` (see the Change Tracking Availability Check in `SKILL.md`).

---

## Step 1: Generate the SDK

Run from the directory that contains `src/`:

```
apimatic sdk generate --language=typescript --track-changes
```

Output:

```
SDK generated successfully.
|
•  The generated SDK can be found at '<project-dir>\sdk\typescript'.
|
•  Change tracking is enabled for 'typescript'. The 'sdk-source-tree' has been saved to '<project-dir>\src\sdk-source-tree\.typescript'.
|
o  Next Steps -------------------------------------------------------------+
|                                                                          |
|  Customize your SDK, then run:                                           |
|  'apimatic sdk save-changes --language=typescript'                       |
|  This persists your changes so they reapply on every future generation.  |
|                                                                          |
+--------------------------------------------------------------------------+
|
—  Succeeded
```

---

## Step 2: Customize the generated SDK

Edit any generated file. In this example, `sdk/typescript/README.md` is updated:

```diff
- This is a sample Pet Store Server based on the OpenAPI 3.0 specification. You can find out more about Swagger at https://swagger.io. In the third iteration of the pet store, we've switched to the design first approach!

+ This is a sample Pet Store Server built on the OpenAPI 3.0 specification. It demonstrates a fully functional REST API for managing pets, orders, and users. For more information about the OpenAPI standard and tooling, visit https://swagger.io.
```

---

## Step 3: Save the changes

```
apimatic sdk save-changes --language=typescript
```

Output:

```
T   Save Changes
|
•  Detected changes in the following file(s):
|    └─ typescript
|     └─ README.md # Modified
|
|
o  Do you want to review these changes?
|  No
|
*  Changes saved successfully at '<project-dir>\src\sdk-source-tree\.typescript'.
|
•  Your saved changes will reapply automatically the next time you generate this SDK.
|
—  Succeeded
```

---

## Step 4: Regenerate

```
apimatic sdk generate --language=typescript
```

Output:

```
T   Generate SDK
|
o  The destination '<project-dir>\sdk' is not empty, do you want to overwrite?
|  Yes
|
o  SDK generated successfully.
|
•  Successfully applied saved changes for 'typescript' SDK.
|
•  The generated SDK can be found at '<project-dir>\sdk\typescript'
|    and the 'sdk-source-tree' can be found at '<project-dir>\src\sdk-source-tree\.typescript'.
|
—  Succeeded
```
