# First-Time Setup: Scaffolding the Project

Use this when the user does not have a `src/` folder yet and needs to set up a project from scratch for SDK generation.

---

## Step 1: Get the project directory

Ask the user: "Where would you like me to set up the project directory? (Give a path, or I'll use the current directory)"

- If the user provides a path, use that as the project root.
- If no path given, use the current working directory.

---

## Step 2: Get the API spec file

Ask the user: "What is the path to your API specification file? (OpenAPI JSON/YAML, Postman collection, or other supported format)"

Store the spec file path.

APIMatic accepts OpenAPI/Swagger (3.1, 3.0, 2.0, 1.x), RAML (1.0, 0.8), Postman Collection (2.0, 1.0), Insomnia, HAR, API Blueprint, WADL, WSDL, Google Discovery, I/O Docs, and APIMatic format.

---

## Step 3: Create the directory structure

Create the `src/spec/` directory inside the project root:

```bash
mkdir -p <project-root>/src/spec
```

On Windows PowerShell:

```powershell
New-Item -ItemType Directory -Force -Path "<project-root>\src\spec"
```

---

## Step 4: Copy the user's spec file

Copy the user's API spec into `src/spec/`:

```bash
cp <spec-file> <project-root>/src/spec/
```

On Windows PowerShell:

```powershell
Copy-Item "<spec-file>" -Destination "<project-root>\src\spec\"
```

---

## Step 5: Verify the structure

After setup, the project directory should look like this:

```
<project-root>/
└── src/
    └── spec/
        └── <user-spec-file>       (e.g., openapi.json, petstore.yaml)
```

Optionally run `apimatic api validate` from the project root to catch spec errors before generating. It checks the definition in `src/spec/`.

Navigate to the project root and continue with the SDK generation workflow.
